#!/usr/bin/env bash
# End-to-end smoke test for the built `secretariat` CLI. Checklist: docs/secretariat/e2e-checklist.md
#
# Usage: scripts/secretariat/e2e-smoke.sh [--with-model] [--cli <path to zcode.cjs>]
#
# Without --with-model, every check runs in a throwaway data directory and needs no model, network or
# keys. With --with-model it also sends one real prompt using the model configured in
# $SECRETARIAT_E2E_DATA_BASE_DIR (default ~/.secretariat-dev-home, the `mise run dev` data directory).
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cli="${repo_root}/apps/zcode-cli/packages/cli/dist/zcode.cjs"
with_model=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-model) with_model=1 ;;
    --cli) cli="$2"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

if [[ ! -f "$cli" ]]; then
  echo "CLI not built: $cli" >&2
  echo "Build it: pnpm exec turbo run build --cwd apps/zcode-cli --filter=@zcode/cli" >&2
  exit 2
fi

passed=0
failed=0
out_file="$(mktemp)"
base="$(mktemp -d)"
trap 'rm -rf "$base" "$out_file"' EXIT

# Runs the CLI with only the variables given, in the throwaway data directory.
sec() {
  env -i PATH="$PATH" HOME="$base" SECRETARIAT_DATA_BASE_DIR="$base" "$@"
}

# check <name> <expected exit code> <regex the output must match, or ""> -- <command...>
check() {
  local name="$1" expected_exit="$2" pattern="$3"
  shift 4
  "$@" >"$out_file" 2>&1
  local exit_code=$?
  if [[ "$exit_code" -eq "$expected_exit" ]] && { [[ -z "$pattern" ]] || grep -Eq "$pattern" "$out_file"; }; then
    echo "PASS  $name"
    passed=$((passed + 1))
  else
    echo "FAIL  $name (exit $exit_code, expected $expected_exit)"
    sed 's/^/      /' "$out_file" | tail -5
    failed=$((failed + 1))
  fi
}

# assert <name> <command...>: passes when the command succeeds.
assert() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "PASS  $name"
    passed=$((passed + 1))
  else
    echo "FAIL  $name"
    failed=$((failed + 1))
  fi
}

echo "CLI: $cli"
echo "Data directory: $base/.secretariat"
echo

echo "== Environment guard (#8)"
check "unguarded command runs without SECRETARIAT_DEPLOYMENT" 0 "" -- \
  sec node "$cli" version
check "headless -p refuses without SECRETARIAT_DEPLOYMENT" 1 "must be set to \"test\" or \"prod\"" -- \
  sec node "$cli" -p "hello"
check "invalid SECRETARIAT_DEPLOYMENT is refused" 1 "must be \"test\" or \"prod\"" -- \
  sec SECRETARIAT_DEPLOYMENT=production node "$cli" -p "hello"
check "status before first run shows an unbound directory" 0 "data directory: unbound" -- \
  sec SECRETARIAT_DEPLOYMENT=test node "$cli" deployment status
check "unregistered credential is refused" 1 "OPENROUTER_API_KEY is not registered for the test deployment" -- \
  sec SECRETARIAT_DEPLOYMENT=test OPENROUTER_API_KEY=sk-or-e2e-first node "$cli" -p "hello"
check "register needs an explicit environment" 1 "Set SECRETARIAT_DEPLOYMENT" -- \
  sec OPENROUTER_API_KEY=sk-or-e2e-first node "$cli" deployment register
check "register records the credential" 0 "Registered OPENROUTER_API_KEY for the test deployment" -- \
  sec SECRETARIAT_DEPLOYMENT=test OPENROUTER_API_KEY=sk-or-e2e-first node "$cli" deployment register
assert "deployment.json holds a fingerprint, not the key" \
  bash -c "grep -q 'sha256:' '$base/.secretariat/deployment.json' && ! grep -q 'sk-or-e2e-first' '$base/.secretariat/deployment.json'"
assert "deployment.json is private (0600)" \
  bash -c "[[ \$(stat -c %a '$base/.secretariat/deployment.json' 2>/dev/null || stat -f %Lp '$base/.secretariat/deployment.json') == 600 ]]"
check "status shows the credential as registered, without its value" 0 "OPENROUTER_API_KEY: set, registered" -- \
  sec SECRETARIAT_DEPLOYMENT=test OPENROUTER_API_KEY=sk-or-e2e-first node "$cli" deployment status
assert "status output contains no key or fingerprint" \
  bash -c "! grep -Eq 'sk-or-e2e-first|sha256:' '$out_file'"
check "a changed credential is refused" 1 "differs from the one registered" -- \
  sec SECRETARIAT_DEPLOYMENT=test OPENROUTER_API_KEY=sk-or-e2e-rotated node "$cli" -p "hello"
check "the other environment is refused on this directory" 1 "belongs to the test deployment, but SECRETARIAT_DEPLOYMENT is prod" -- \
  sec SECRETARIAT_DEPLOYMENT=prod node "$cli" -p "hello"
check "error messages never print the key" 1 "" -- \
  sec SECRETARIAT_DEPLOYMENT=test OPENROUTER_API_KEY=sk-or-e2e-rotated node "$cli" -p "hello"
assert "…checked: no key in that output" bash -c "! grep -q 'sk-or-e2e-rotated' '$out_file'"

echo
echo "== Headless run and logs (#51)"
marker="e2e-marker-$RANDOM-$RANDOM"
# No model is configured here, so the run itself fails after the guard passes; it still writes agent
# logs, which is what the next checks need.
sec SECRETARIAT_DEPLOYMENT=test node "$cli" -p "please summarise $marker" >"$out_file" 2>&1
# Proves the run got past the guard into the runtime: the agent wrote log lines for it.
assert "the run got past the guard and wrote agent logs" \
  bash -c "compgen -G '$base/.secretariat/cli/log/*.jsonl' >/dev/null && [[ -s \$(ls '$base/.secretariat/cli/log/'*.jsonl | head -1) ]]"
check "logs --service agent shows recent agent lines" 0 '"level":"(info|warn|error)"' -- \
  sec node "$cli" logs --service agent --since 10m
# Runs only after the previous check proved the log directory has content, so it can't pass vacuously.
assert "the prompt text is not in any log file" bash -c "! grep -rq '$marker' '$base/.secretariat/cli/log'"
check "logs-only flags are rejected on other commands" 1 "can only be used with \`logs\`" -- \
  sec node "$cli" version --limit 5
check "logs rejects a bad --since" 1 "Invalid --since" -- \
  sec node "$cli" logs --since yesterday
check "logs --audit with no audit log yet" 0 "No logs in" -- \
  sec node "$cli" logs --audit

if [[ "$with_model" -eq 1 ]]; then
  echo
  echo "== Real model (needs a model configured in the data directory below)"
  model_base="${SECRETARIAT_E2E_DATA_BASE_DIR:-$HOME/.secretariat-dev-home}"
  echo "Data directory: $model_base/.secretariat"
  model_marker="e2e-model-$RANDOM-$RANDOM"
  check "-p answers with the configured model (build mode)" 0 "\\bOK\\b" -- \
    env SECRETARIAT_DATA_BASE_DIR="$model_base" SECRETARIAT_DEPLOYMENT=test \
    node "$cli" -p "Reply with the single word OK. ($model_marker)"
  if grep -q "not registered" "$out_file"; then
    echo "      hint: register your shell's keys for $model_base first (see docs/secretariat/e2e-checklist.md)"
  fi
  # Read the agent log through the CLI (it knows where the agent writes) and require content first.
  env SECRETARIAT_DATA_BASE_DIR="$model_base" node "$cli" logs --service agent --since 10m >"$out_file" 2>&1
  assert "the model run wrote agent log lines" test -s "$out_file"
  assert "the prompt text is not in the agent log" bash -c "! grep -q '$model_marker' '$out_file'"
fi

echo
echo "$passed passed, $failed failed"
[[ "$failed" -eq 0 ]]
