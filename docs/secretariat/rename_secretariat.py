"""Rename ZCode identity/branding to Secretariat (scope: identity + branding).

Changes, applied to tracked text files only:
  1. Data dirs:   .zcode            -> .secretariat   (not .zcode-plugin, not hostnames)
                  .zcode-dev-home   -> .secretariat-dev-home
  2. Env vars:    ZCODE_*           -> SECRETARIAT_*
  3. Product:     ZCode / Zcode     -> Secretariat;  ZCodeProject -> SecretariatProject
  4. Deep links:  zcode://          -> secretariat://  (+ scheme constants)
  5. App ID:      dev.zcode.app     -> dev.secretariat.app
  6. CLI caches:  Library/Caches/zcode etc. -> secretariat
  7. CLI command: bin name + CLI help text  zcode -> secretariat

Left alone on purpose: @zcode/* package names, file/dir names, code identifiers
(ZCodeAgent, zcodeFoo), the .zcode-plugin manifest dir, Z.ai/BigModel provider code,
license/notice files, lockfiles, vendored third-party and Electron docs.

Usage: python3 -I rename_secretariat.py <repo-root> [--dry-run]
"""
import re
import subprocess
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
dry = "--dry-run" in sys.argv

EXCLUDE_EXACT = {
    "LICENSE", "NOTICE.md", "THIRD-PARTY-NOTICES.md",
    "pnpm-lock.yaml", "package-lock.json",
    "apps/zcode-cli/pnpm-lock.yaml",
}
EXCLUDE_PREFIX = ("third-party/", "docs/electron/", "patches/", "docs/secretariat/")
EXCLUDE_SUFFIX = (
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".icns", ".webp", ".woff", ".woff2",
    ".ttf", ".otf", ".mp4", ".mov", ".zip", ".gz", ".wasm", ".node", ".pdf", ".lock",
)

GLOBAL_RULES = [
    ("data-dir", re.compile(r"\.zcode-dev-home"), ".secretariat-dev-home"),
    # Path segment only: not after a word char, '-', '.', ')', ']', '?' or an escaped word
    # (those are spreads `...zcode`, member access `x).zcode`, `?.zcode`, `window\.zcode`).
    ("data-dir", re.compile(r"(?<![\w\-.)\]?])(?<!\w\\)\.zcode(?![\w-])"), ".secretariat"),
    ("env", re.compile(r"\bZCODE_"), "SECRETARIAT_"),
    ("product", re.compile(r"\bZCodeProject\b"), "SecretariatProject"),
    ("product", re.compile(r"\bZ[Cc]ode\b"), "Secretariat"),
    ("deeplink", re.compile(r"\bzcode://"), "secretariat://"),
    ("appid", re.compile(r"\bdev\.zcode\.app\b"), "dev.secretariat.app"),
]

# Targeted, per-file rules: (path, pattern, replacement, expected_min_count)
FILE_RULES = [
    ("packages/desktop/src/main/desktopDeepLinkUrl.ts",
     r'const DEEP_LINK_SCHEME = "zcode";', 'const DEEP_LINK_SCHEME = "secretariat";', 1),
    ("packages/desktop/src/main/desktopDeepLinkUrl.ts",
     r"/\bzcode:(?:", r"/\bsecretariat:(?:", 1),
    ("packages/desktop/electron-builder.config.js",
     'schemes: ["zcode"]', 'schemes: ["secretariat"]', 1),
    ("apps/zcode-cli/packages/cli/package.json",
     '"zcode": "./dist/zcode.cjs"', '"secretariat": "./dist/zcode.cjs"', 1),
]
for f in ("apps/zcode-cli/packages/cli/src/sea-playwright-runtime.ts",
          "apps/zcode-cli/packages/cli/src/tui-runtime-loader.ts"):
    FILE_RULES += [
        (f, '"Caches", "zcode"', '"Caches", "secretariat"', 1),
        (f, '"AppData", "Local"),\n      "zcode",', '"AppData", "Local"),\n      "secretariat",', 1),
        (f, '".cache"),\n    "zcode",', '".cache"),\n    "secretariat",', 1),
    ]
# CLI help text: bare `zcode` command word in the CLI locale files only.
CLI_HELP_FILES = ["apps/zcode-cli/packages/i18n/src/locales/en-US.ts",
                  "apps/zcode-cli/packages/i18n/src/locales/zh-CN.ts"]
CLI_WORD = re.compile(r"(?<![@/\w.-])zcode(?![\w/.-])")


def tracked_files():
    out = subprocess.run(["git", "-C", str(root), "ls-files", "-z"],
                         capture_output=True, check=True).stdout
    for rel in out.decode().split("\0"):
        if not rel or rel in EXCLUDE_EXACT or rel.startswith(EXCLUDE_PREFIX):
            continue
        if rel.lower().endswith(EXCLUDE_SUFFIX) or rel.endswith("pnpm-lock.yaml"):
            continue
        yield rel


counts, files_changed = {}, 0
for rel in tracked_files():
    p = root / rel
    if p.is_symlink() or not p.is_file():
        continue
    raw = p.read_bytes()
    if b"\0" in raw[:8192]:
        continue
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        continue
    new = text
    for name, rx, rep in GLOBAL_RULES:
        new, n = rx.subn(rep, new)
        if n:
            counts[name] = counts.get(name, 0) + n
    for f, old, rep, minimum in FILE_RULES:
        if f == rel:
            n = new.count(old)
            if n < minimum:
                sys.exit(f"targeted rule failed in {rel}: {old!r} found {n}x")
            new = new.replace(old, rep)
            counts["targeted"] = counts.get("targeted", 0) + n
    if rel in CLI_HELP_FILES:
        new, n = CLI_WORD.subn("secretariat", new)
        counts["cli-help"] = counts.get("cli-help", 0) + n
    if new != text:
        files_changed += 1
        if not dry:
            p.write_text(new, encoding="utf-8")

print(f"files changed: {files_changed}")
for k, v in sorted(counts.items()):
    print(f"  {k:10s} {v}")
