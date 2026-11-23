"""Turn workflow_dispatch inputs into a build matrix.

Reads env TARGETS (JSON list of recipe objects, or a path to a JSON file in this repo) and/or
the single-target env vars T_TEMPLATE, T_REPO, T_COMMIT, T_RUSTC, T_BUILDER, T_TARI_CLI,
T_SCRIPT, T_WORKDIR, T_REMAP, T_RUSTFLAGS, T_OPTIMIZER, T_OS. Prints `matrix=<json>` for $GITHUB_OUTPUT.

Recipe fields (all optional except template/repo/commit):
  rustc      toolchain to force (else the repo's rust-toolchain(.toml), else stable)
  builder    auto | tari-cli | cargo | script | cmd
  cmd        shell command run from the repo root (builder=cmd)
  tari_cli   tari-ootle-cli version for builder=tari-cli (e.g. 0.30.0)
  script     path of a build script in the repo (builder=script), run with bash from the repo root
  workdir    sub-directory holding the template crate (cargo / tari-cli builders)
  remap      prefix CARGO_HOME is remapped to (default /build/.cargo), or "none"
  rustflags  raw RUSTFLAGS; {CARGO_HOME} and {SRC} are substituted (overrides remap)
  optimizer  auto | on | off  (walletd v0.55.0 wasm-opt pass)
  os         ubuntu-latest | windows-latest
"""
import json, os, re

FIELDS = ["template", "repo", "commit", "rustc", "builder", "tari_cli", "script", "workdir",
          "remap", "rustflags", "optimizer", "os", "cmd"]


def norm(t):
    t = {k: (str(t.get(k) or "").strip()) for k in FIELDS} | {"name": str(t.get("name") or "")}
    t["template"] = t["template"].removeprefix("template_").lower()
    if not re.fullmatch(r"[0-9a-f]{64}", t["template"]):
        raise SystemExit(f"bad template address: {t['template']!r}")
    if not t["repo"] or not t["commit"]:
        raise SystemExit(f"template {t['template']}: repo and commit are required")
    if not t["builder"] or t["builder"] == "auto":
        t["builder"] = "cmd" if t["cmd"] else "script" if t["script"] else ("tari-cli" if t["tari_cli"] else "cargo")
    t["remap"] = t["remap"] or "/build/.cargo"
    t["optimizer"] = t["optimizer"] or "auto"
    t["os"] = t["os"] or "ubuntu-latest"
    t["id"] = t["template"][:12]
    return t


def main():
    targets = []
    raw = os.environ.get("TARGETS", "").strip()
    if raw:
        if not raw.startswith("["):
            raw = open(raw).read()
        targets += json.loads(raw)
    if os.environ.get("T_TEMPLATE", "").strip():
        targets.append({k: os.environ.get("T_" + k.upper(), "") for k in FIELDS})
    if not targets:
        raise SystemExit("no targets given")
    m = [norm(t) for t in targets]
    line = "matrix=" + json.dumps({"include": m})
    if os.environ.get("GITHUB_OUTPUT"):
        open(os.environ["GITHUB_OUTPUT"], "a").write(line + "\n")
    print(line)


if __name__ == "__main__":
    main()
