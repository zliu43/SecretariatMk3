import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { atomicWritePrivateTextFile } from "./privateFilePersistence.js";

// Spec: docs/secretariat/specs/environment-guard.md

export const SECRETARIAT_DEPLOYMENT_ENV = "SECRETARIAT_DEPLOYMENT";
export const DEPLOYMENT_RECORD_FILE_NAME = "deployment.json";

/** Environment variables holding secrets for outside services; grows with integrations. */
export const GUARDED_CREDENTIAL_ENV_KEYS = [
  "OPENROUTER_API_KEY",
  "BRAVE_API_KEY",
  "SECRETARIAT_GATEWAY_TOKEN",
] as const;

export type SecretariatDeployment = "test" | "prod";

export type DeploymentGuardErrorCode =
  | "deployment.missing"
  | "deployment.invalid"
  | "record.mismatch"
  | "record.unreadable"
  | "credential.unregistered"
  | "credential.changed";

export class DeploymentGuardError extends Error {
  constructor(
    readonly code: DeploymentGuardErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DeploymentGuardError";
  }
}

interface DeploymentRecord {
  version: 1;
  deployment: SecretariatDeployment;
  credentials: Record<string, string>;
}

type Env = Record<string, string | undefined>;

export interface DeploymentGuardOptions {
  env: Env;
  /** The `.secretariat` data directory. */
  dataDir: string;
  /** Interactive entries (desktop, TUI) run as `test` when the variable is unset. */
  interactive: boolean;
}

export interface DeploymentGuardResult {
  deployment: SecretariatDeployment;
  /** `default` when an interactive entry fell back to `test`. */
  source: "env" | "default";
  recordPath: string;
  recordCreated: boolean;
}

export function resolveSecretariatDataDir(env: Env): string {
  const base = env.SECRETARIAT_DATA_BASE_DIR?.trim() || homedir();
  return join(base, ".secretariat");
}

export function fingerprintCredential(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function readDeclaredDeployment(env: Env): SecretariatDeployment | undefined {
  const raw = env[SECRETARIAT_DEPLOYMENT_ENV]?.trim();
  if (!raw) return undefined;
  if (raw === "test" || raw === "prod") return raw;
  throw new DeploymentGuardError(
    "deployment.invalid",
    `${SECRETARIAT_DEPLOYMENT_ENV} must be "test" or "prod".`,
  );
}

function presentCredentials(env: Env): Array<[string, string]> {
  return GUARDED_CREDENTIAL_ENV_KEYS.flatMap((key) => {
    const value = env[key]?.trim();
    return value ? [[key, value] as [string, string]] : [];
  });
}

async function readRecord(recordPath: string): Promise<DeploymentRecord | undefined> {
  let content: string;
  try {
    content = await readFile(recordPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new DeploymentGuardError("record.unreadable", `Cannot read ${recordPath}.`);
  }
  try {
    const parsed = JSON.parse(content) as Partial<DeploymentRecord>;
    if (
      parsed.version === 1 &&
      (parsed.deployment === "test" || parsed.deployment === "prod") &&
      typeof parsed.credentials === "object" &&
      parsed.credentials !== null &&
      Object.values(parsed.credentials).every((value) => typeof value === "string")
    ) {
      return parsed as DeploymentRecord;
    }
  } catch {
    // Reported below; the file is never overwritten.
  }
  throw new DeploymentGuardError(
    "record.unreadable",
    `${recordPath} is not a valid deployment record. Fix or remove it by hand.`,
  );
}

/** First-run binding: create only if absent, so two processes can't both bind a fresh directory. */
async function createRecordExclusively(
  recordPath: string,
  record: DeploymentRecord,
): Promise<boolean> {
  await mkdir(dirname(recordPath), { recursive: true });
  try {
    await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

async function writeRecord(recordPath: string, record: DeploymentRecord): Promise<void> {
  await atomicWritePrivateTextFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
}

function assertRecordMatches(
  record: DeploymentRecord,
  deployment: SecretariatDeployment,
  recordPath: string,
): void {
  if (record.deployment !== deployment) {
    throw new DeploymentGuardError(
      "record.mismatch",
      `${recordPath} belongs to the ${record.deployment} deployment, but ${SECRETARIAT_DEPLOYMENT_ENV} is ${deployment}. Point SECRETARIAT_DATA_BASE_DIR at the ${deployment} data directory.`,
    );
  }
}

/** Runs at startup before anything else; throws DeploymentGuardError on any mismatch. */
export async function checkDeploymentGuard(
  options: DeploymentGuardOptions,
): Promise<DeploymentGuardResult> {
  const declared = readDeclaredDeployment(options.env);
  if (!declared && !options.interactive) {
    throw new DeploymentGuardError(
      "deployment.missing",
      `${SECRETARIAT_DEPLOYMENT_ENV} must be set to "test" or "prod" for headless and server runs.`,
    );
  }
  const deployment = declared ?? "test";
  const recordPath = join(options.dataDir, DEPLOYMENT_RECORD_FILE_NAME);

  let record = await readRecord(recordPath);
  let recordCreated = false;
  if (!record) {
    recordCreated = await createRecordExclusively(recordPath, {
      version: 1,
      deployment,
      credentials: {},
    });
    // Another process may have bound the directory first; its record decides.
    record = await readRecord(recordPath);
    if (!record) throw new DeploymentGuardError("record.unreadable", `Cannot read ${recordPath}.`);
  }
  assertRecordMatches(record, deployment, recordPath);

  for (const [key, value] of presentCredentials(options.env)) {
    const registered = record.credentials[key];
    if (!registered) {
      throw new DeploymentGuardError(
        "credential.unregistered",
        `${key} is not registered for the ${deployment} deployment. If it belongs to ${deployment}, run \`secretariat deployment register\`.`,
      );
    }
    if (registered !== fingerprintCredential(value)) {
      throw new DeploymentGuardError(
        "credential.changed",
        `${key} differs from the one registered for the ${deployment} deployment. If it was rotated, run \`secretariat deployment register\`.`,
      );
    }
  }

  return {
    deployment,
    source: declared ? "env" : "default",
    recordPath,
    recordCreated,
  };
}

export interface DeploymentRegisterResult {
  deployment: SecretariatDeployment;
  recordPath: string;
  registered: string[];
}

/** Records fingerprints of the guarded credentials that are set. Needs an explicit environment. */
export async function registerDeploymentCredentials(options: {
  env: Env;
  dataDir: string;
}): Promise<DeploymentRegisterResult> {
  const deployment = readDeclaredDeployment(options.env);
  if (!deployment) {
    throw new DeploymentGuardError(
      "deployment.missing",
      `Set ${SECRETARIAT_DEPLOYMENT_ENV} to "test" or "prod" before registering credentials.`,
    );
  }
  const recordPath = join(options.dataDir, DEPLOYMENT_RECORD_FILE_NAME);
  const record = (await readRecord(recordPath)) ?? { version: 1, deployment, credentials: {} };
  assertRecordMatches(record, deployment, recordPath);

  const present = presentCredentials(options.env);
  const credentials = { ...record.credentials };
  for (const [key, value] of present) credentials[key] = fingerprintCredential(value);
  await writeRecord(recordPath, { version: 1, deployment, credentials });

  return { deployment, recordPath, registered: present.map(([key]) => key) };
}

export interface DeploymentStatus {
  declared: SecretariatDeployment | undefined;
  recordPath: string;
  recordDeployment: SecretariatDeployment | undefined;
  credentials: Array<{ key: string; set: boolean; registered: boolean; matches: boolean }>;
}

/** Read-only summary for `secretariat deployment status`; never includes values or fingerprints. */
export async function readDeploymentStatus(options: {
  env: Env;
  dataDir: string;
}): Promise<DeploymentStatus> {
  const declared = readDeclaredDeployment(options.env);
  const recordPath = join(options.dataDir, DEPLOYMENT_RECORD_FILE_NAME);
  const record = await readRecord(recordPath);
  return {
    declared,
    recordPath,
    recordDeployment: record?.deployment,
    credentials: GUARDED_CREDENTIAL_ENV_KEYS.map((key) => {
      const value = options.env[key]?.trim();
      const registered = record?.credentials[key];
      return {
        key,
        set: Boolean(value),
        registered: Boolean(registered),
        matches: Boolean(value && registered === fingerprintCredential(value)),
      };
    }),
  };
}
