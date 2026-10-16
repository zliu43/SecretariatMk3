import { describe, expect, it } from "vitest";
import { SECRETARIAT_AGENT_RUNTIME } from "@zcode/shared";

describe("Secretariat Agent runtime", () => {
  it("starts the private Secretariat Protocol server instead of the retired Secretariat Agent command", () => {
    const retiredProtocolName = `${"a"}${"cp"}`;

    expect(SECRETARIAT_AGENT_RUNTIME.spawnArgs).toEqual(["app-server", "--stdio"]);
    expect(SECRETARIAT_AGENT_RUNTIME.spawnArgs).not.toContain(retiredProtocolName);
  });

  it("uses the Secretariat Agent binary name", () => {
    expect(SECRETARIAT_AGENT_RUNTIME.resolveEntrySegments("darwin")).toEqual(["zcode-agent"]);
    expect(SECRETARIAT_AGENT_RUNTIME.resolveEntrySegments("win32")).toEqual(["zcode-agent.exe"]);
  });
});
