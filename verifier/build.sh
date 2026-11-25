#!/usr/bin/env bash
# Build one recipe from source. UNTRUSTED code (build.rs, proc macros, build scripts, linkers) runs in step 5.
# Env: R_TEMPLATE R_REPO R_COMMIT R_RUSTC R_BUILDER R_TARI_CLI R_SCRIPT R_WORKDIR R_REMAP R_RUSTFLAGS R_OPTIMIZER R_CMD
#      OUT          output dir (uploaded as the build artifact)
#      ONCHAIN_JSON optional; only used to delete committed copies of the on-chain binary before the build
#      TOOLS_DIR    holds bin/tari (tari-ootle-cli), installed by an earlier step; mounted read-only
# Writes $OUT/candidate.wasm (the target crate's release output and nothing else), $OUT/build.json, $OUT/build.log.
# The record job trusts none of $OUT except the candidate bytes (build.json is informational and can only
# downgrade the isolation verdict).
#
# Linux isolation: the build runs in `docker run --network none --user <runner uid> --cap-drop ALL
# --security-opt no-new-privileges --read-only` with the source mounted read-write and the cargo home,
# rustup toolchain and tools mounted read-only at the same paths as on the runner (so the bytes are the same
# as a build on the runner). There is no sudo in the image and no capability to enter another namespace.
# Windows runners cannot be isolated this way; their records keep a "not isolated" warning.
set -uo pipefail
OUT="${OUT:?}"; mkdir -p "$OUT"; rm -f "$OUT/candidate.wasm"
SRC="${SRC_DIR:-$RUNNER_TEMP/src}"
SRC="$(cygpath -u "$SRC" 2>/dev/null || echo "$SRC")"
TOOLS="${TOOLS_DIR:-$RUNNER_TEMP/onescan-tools}"
TOOLS="$(cygpath -u "$TOOLS" 2>/dev/null || echo "$TOOLS")"
mkdir -p "$TOOLS/bin"
LOG="$OUT/build.log"; : > "$LOG"
IMAGE="${ONESCAN_BUILD_IMAGE:-onescan-build:local}"
PROBE_URL="https://indexer-a.ootle.tari.com/"
err=""
fail() { [ -z "$err" ] && err="$1"; echo "ERROR: $1" | tee -a "$LOG" >&2; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$(command -v python3 2>/dev/null || command -v python)"
PY_W="$(command -v python 2>/dev/null || echo "$PY")"  # Windows: the setup-python interpreter

# The on-chain binary must not be on disk while untrusted build code runs (it could just copy it).
[ -n "${ONCHAIN_JSON:-}" ] && rm -f "$(dirname "$ONCHAIN_JSON")/onchain.wasm"

# 1) Source
git clone --quiet "$R_REPO" "$SRC" || fail "git clone failed"
[ -z "$err" ] && { git -C "$SRC" checkout --quiet "$R_COMMIT" || fail "commit $R_COMMIT not found in $R_REPO"; }
COMMIT_FULL="$(git -C "$SRC" rev-parse HEAD 2>/dev/null || echo "")"
WD="$SRC${R_WORKDIR:+/$R_WORKDIR}"

# 2) Toolchain: recipe override, else rust-toolchain(.toml) found upward from the workdir, else stable.
#    It must be a plain rustup channel; RUSTUP_TOOLCHAIN then overrides any toolchain file in the repo.
TC="${R_RUSTC:-}"
if [ -z "$TC" ]; then
  d="$WD"; n=0
  while [ -n "$d" ] && [ "$d" != "/" ] && [ "$d" != "." ] && [ $n -lt 20 ]; do
    n=$((n+1))
    for f in "$d/rust-toolchain.toml" "$d/rust-toolchain"; do
      if [ -f "$f" ] && [ -z "$TC" ]; then
        TC="$(grep -E '^\s*channel' "$f" | sed -E 's/.*"([^"]+)".*/\1/' | head -1)"
        [ -z "$TC" ] && TC="$(head -1 "$f" | tr -d '[:space:]')"
      fi
    done
    [ "$d" = "$SRC" ] && break
    d="$(dirname "$d")"
  done
fi
TC="${TC:-stable}"
if ! [[ "$TC" =~ ^(stable|beta|nightly|[0-9]+\.[0-9]+(\.[0-9]+)?)(-[0-9]{4}-[0-9]{2}-[0-9]{2})?(-[a-z0-9_]+){0,4}$ ]]; then
  fail "toolchain '${TC:0:60}' is not a rustup channel"; TC="stable"
fi
echo "toolchain: $TC" | tee -a "$LOG"
[ -z "$err" ] && { rustup toolchain install "$TC" --profile minimal --target wasm32-unknown-unknown >>"$LOG" 2>&1 || fail "rustup install $TC failed"; }
export RUSTUP_TOOLCHAIN="$TC"

# 3) Hard source checks BEFORE cargo reads the repo (a hostile .cargo/config could run code during fetch).
if [ -z "$err" ]; then
  "$PY_W" -I "$HERE/srccheck.py" --config-only "$SRC" 2>&1 | tee -a "$LOG"
  [ "${PIPESTATUS[0]}" = 0 ] || fail "rejected by source checks (cargo config / toolchain file / symlink); not built"
fi

CH="${CARGO_HOME:-$HOME/.cargo}"
CH_NATIVE="$(cygpath -w "$CH" 2>/dev/null || echo "$CH")"
SRC_NATIVE="$(cygpath -w "$SRC" 2>/dev/null || echo "$SRC")"
if [ -n "${R_RUSTFLAGS:-}" ]; then
  RF="${R_RUSTFLAGS//\{CARGO_HOME\}/"$CH_NATIVE"}"; RF="${RF//\{SRC\}/"$SRC_NATIVE"}"
  export RUSTFLAGS="$RF"
elif [ "${R_REMAP:-/build/.cargo}" != "none" ]; then
  export RUSTFLAGS="--remap-path-prefix=$CH_NATIVE=${R_REMAP:-/build/.cargo}"
fi
echo "RUSTFLAGS=${RUSTFLAGS:-}" | tee -a "$LOG"
LOCKED="no"; { [ -f "$WD/Cargo.lock" ] || [ -f "$SRC/Cargo.lock" ]; } && LOCKED="yes"

# 4) Fetch every dependency while the network is available. cargo fetch runs no build scripts.
LOCK_OK="yes"; FETCH_DIRS="$WD"
while IFS= read -r l; do FETCH_DIRS="$FETCH_DIRS"$'\n'"$SRC/$(dirname "$l")"; done < <(git -C "$SRC" ls-files '*Cargo.lock' 2>/dev/null)
if [ -z "$err" ]; then
  while IFS= read -r d; do
    [ -f "$d/Cargo.toml" ] || continue
    (cd "$d" && env -u RUSTFLAGS cargo fetch --locked) >>"$LOG" 2>&1 || { LOCK_OK="no"; (cd "$d" && env -u RUSTFLAGS cargo fetch) >>"$LOG" 2>&1 || echo "cargo fetch failed in $d" | tee -a "$LOG"; }
  done < <(printf '%s\n' "$FETCH_DIRS" | sort -u)
  # Delete committed *.wasm and any committed copy of the on-chain binary (report is informational here;
  # the record job re-runs the checks on its own fresh checkout).
  "$PY_W" -I "$HERE/srccheck.py" "$SRC" "$WD" "${ONCHAIN_JSON:--}" "${RUNNER_TEMP:-/tmp}/source_check.build.json" >>"$LOG" 2>&1 \
    || echo "srccheck (build side) failed" | tee -a "$LOG"
fi

# The only file accepted from this build: <target dir>/wasm32-unknown-unknown/release/<lib>.wasm of the
# template crate, computed now, before any untrusted code has run.
EXP_JSON='{}'; REL=""
if [ -z "$err" ]; then
  EXP_JSON="$("$PY_W" -I "$HERE/expect.py" "$SRC" "$WD")"
  echo "expected output: $EXP_JSON" | tee -a "$LOG"
  REL="$(printf '%s' "$EXP_JSON" | "$PY_W" -I -c 'import json,sys;print(json.load(sys.stdin).get("rel",""))')"
  [ -n "$REL" ] || fail "no expected output path: $EXP_JSON"
fi

TARI_BEFORE=""; TARI_AFTER=""
if [ "$R_BUILDER" = tari-cli ]; then
  if [ -x "$TOOLS/bin/tari" ] || [ -x "$TOOLS/bin/tari.exe" ]; then
    TARI_BEFORE="$(sha256sum "$TOOLS"/bin/tari* | head -1 | cut -d' ' -f1)"
    echo "tari-ootle-cli sha256 before build: $TARI_BEFORE" | tee -a "$LOG"
  else
    fail "tari-ootle-cli is not installed in $TOOLS/bin (the workflow installs it before the build)"
  fi
fi

# 5) Isolation, then the untrusted build.
export CARGO_NET_OFFLINE=true
ISOLATED="no"; ISO_NOTE=""; PROBES=""
probe() {  # name, then a command that must FAIL inside the sandbox
  local name="$1"; shift
  if iso "$@" >>"$LOG" 2>&1; then PROBES="$PROBES $name=REACHED"; return 1; else PROBES="$PROBES $name=blocked"; return 0; fi
}
export WD SRC R_SCRIPT R_CMD TOOLS
if [ -n "${ONESCAN_SELFTEST_NO_ISOLATION:-}" ]; then
  iso() { "$@"; }; export PATH="$TOOLS/bin:$PATH"
  ISO_NOTE="selftest control: isolation disabled"
elif [ -n "${ONESCAN_SELFTEST_LEGACY_UNSHARE:-}" ] && [ "${RUNNER_OS:-}" = "Linux" ]; then
  # The pre-hardening design (network namespace, but sudo stays available): kept only for the selftest.
  export PATH="$TOOLS/bin:$PATH"
  _U="$(id -u)"; _G="$(id -g)"; ENVF="${RUNNER_TEMP:-/tmp}/onescan-build-env.sh"
  iso() { export -p > "$ENVF"; sudo unshare --net -- setpriv --reuid="$_U" --regid="$_G" --init-groups -- bash -c 'source "$1" 2>/dev/null; shift; exec "$@"' _ "$ENVF" "$@"; }
  ISO_NOTE="selftest control: legacy unshare namespace with passwordless sudo on the runner"
elif [ "${RUNNER_OS:-}" = "Linux" ]; then
  RH="${RUSTUP_HOME:-$HOME/.rustup}"
  SYSROOT="$(rustc --print sysroot)"
  iso() {
    docker run --rm --network none --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges \
      --read-only --tmpfs /tmp:rw,exec,size=4g --pids-limit 4096 \
      -e HOME=/tmp -e CARGO_HOME="$CH" -e RUSTUP_HOME="$RH" -e RUSTUP_TOOLCHAIN="$TC" -e CARGO_NET_OFFLINE=true \
      -e CARGO_TERM_COLOR=never -e RUSTFLAGS -e WD -e SRC -e R_SCRIPT -e R_CMD -e LOCKFLAG -e TOOLS \
      -e PATH="$TOOLS/bin:$SYSROOT/bin:$CH/bin:/usr/local/bin:/usr/bin:/bin" \
      -v "$SRC:$SRC" -v "$CH:$CH:ro" -v "$RH:$RH:ro" -v "$TOOLS:$TOOLS:ro" -w "$SRC" "$IMAGE" "$@"
  }
  if ! iso true >>"$LOG" 2>&1; then
    fail "could not start the build container ($IMAGE); not building without isolation"
    ISO_NOTE="build container unavailable"
  else
    ok=1
    probe net python3 -c "import urllib.request as u; u.urlopen('$PROBE_URL', timeout=8)" || ok=0
    probe sudo bash -c 'sudo -n true' || ok=0
    probe sudo_nsenter bash -c 'sudo -n nsenter --net=/proc/1/ns/net true' || ok=0
    probe nsenter bash -c 'nsenter --net=/proc/1/ns/net python3 -c "import urllib.request as u; u.urlopen(\"https://indexer-a.ootle.tari.com/\", timeout=8)"' || ok=0
    probe write_cargo_home bash -c 'touch "$CARGO_HOME/.onescan-probe"' || ok=0
    probe write_toolchain bash -c 'touch "$(rustc --print sysroot)/.onescan-probe"' || ok=0
    probe write_tools bash -c 'touch "$TOOLS/bin/.onescan-probe"' || ok=0
    if curl -sS --max-time 15 -o /dev/null "$PROBE_URL" 2>/dev/null; then outside="reachable outside"; else outside="unreachable outside too"; fi
    if [ "$ok" = 1 ]; then
      ISOLATED="yes"; ISO_NOTE="docker --network none, uid $(id -u), no sudo, no capabilities; probes:$PROBES; indexer $outside"
    else
      ISO_NOTE="isolation probe failed:$PROBES"; fail "isolation probe failed:$PROBES; not building"
    fi
  fi
else
  iso() { "$@"; }; export PATH="$TOOLS/bin:$PATH"
  ISO_NOTE="${RUNNER_OS:-unknown} runner: build ran with cargo offline but without network isolation"
fi
echo "network isolated: $ISOLATED ($ISO_NOTE)" | tee -a "$LOG"
LOCKFLAG=""; [ "$LOCK_OK" = yes ] && [ "$LOCKED" = yes ] && LOCKFLAG="--locked"
export LOCKFLAG

if [ -z "$err" ]; then
  case "$R_BUILDER" in
    tari-cli)
      iso bash -c 'cd "$WD" && tari build' 2>&1 | tee -a "$LOG"; [ "${PIPESTATUS[0]}" = 0 ] || fail "tari build failed" ;;
    cargo)
      iso bash -c 'cd "$WD" && cargo build --release --target wasm32-unknown-unknown --offline $LOCKFLAG' 2>&1 | tee -a "$LOG"
      [ "${PIPESTATUS[0]}" = 0 ] || fail "cargo build failed" ;;
    script)
      iso bash -c 'cd "$SRC" && bash "$R_SCRIPT"' 2>&1 | tee -a "$LOG"
      [ "${PIPESTATUS[0]}" = 0 ] || fail "build script $R_SCRIPT failed" ;;
    cmd)
      iso bash -c 'cd "$SRC" && bash -c "$R_CMD"' 2>&1 | tee -a "$LOG"
      [ "${PIPESTATUS[0]}" = 0 ] || fail "build command failed" ;;
    *) fail "unknown builder $R_BUILDER" ;;
  esac
fi

# 6) Take the expected output only (regular file, inside the repo, size-capped).
if [ -z "$err" ]; then
  CHK="$("$PY_W" -I -c '
import os, sys
src, rel = sys.argv[1], sys.argv[2]
p = os.path.join(src, rel)
root = os.path.realpath(src)
if not os.path.lexists(p): print("missing")
elif os.path.islink(p) or not os.path.isfile(p): print("not a regular file")
elif os.path.commonpath([os.path.realpath(p), root]) != root: print("resolves outside the repo")
elif os.path.getsize(p) > 16 * 1024 * 1024: print("larger than 16 MiB")
else: print("ok")' "$SRC_NATIVE" "$REL")"
  if [ "$CHK" = ok ]; then cp "$SRC/$REL" "$OUT/candidate.wasm"; else fail "expected output $REL: $CHK"; fi
fi
echo "other wasm outputs (ignored):" | tee -a "$LOG"
find "$SRC" -path '*/wasm32-unknown-unknown/release/*.wasm' -not -path '*/deps/*' -not -path '*/build/*' 2>/dev/null | tee -a "$LOG"
if [ -n "$TARI_BEFORE" ]; then
  TARI_AFTER="$(sha256sum "$TOOLS"/bin/tari* | head -1 | cut -d' ' -f1)"
  echo "tari-ootle-cli sha256 after build: $TARI_AFTER" | tee -a "$LOG"
fi

RUSTC_V="$(rustc -V 2>/dev/null || echo unknown)"
TARI_V="$( [ "$R_BUILDER" = tari-cli ] && ("$TOOLS/bin/tari" --version 2>/dev/null || echo "tari-ootle-cli $R_TARI_CLI") || echo "")"
export COMMIT_FULL RUSTC_V TARI_V LOCKED err ISOLATED ISO_NOTE LOCK_OK EXP_JSON TARI_BEFORE TARI_AFTER IMAGE
"$PY_W" -I - "$OUT/build.json" <<'PY'
import json, os, sys
e = os.environ
recipe = {k: e.get("R_" + k.upper(), "") for k in
          ["template", "repo", "commit", "rustc", "builder", "tari_cli", "script", "workdir", "remap", "rustflags", "optimizer", "cmd"]}
try:
    exp = json.loads(e.get("EXP_JSON") or "{}")
except Exception:
    exp = {}
linux = e.get("RUNNER_OS") == "Linux"
json.dump({"recipe": recipe, "commit_full": e.get("COMMIT_FULL"), "expected": exp,
           "toolchain": {"rustc": e.get("RUSTC_V"), "rustup_toolchain": e.get("RUSTUP_TOOLCHAIN"),
                         "tari_cli": e.get("TARI_V") or None, "rustflags": e.get("RUSTFLAGS", ""),
                         "cargo_lock_in_repo": e.get("LOCKED") == "yes"},
           "isolation": {"network_isolated": e.get("ISOLATED") == "yes", "note": e.get("ISO_NOTE"),
                         "container_image": e.get("IMAGE") if linux else None,
                         "cargo_offline": True, "lockfile_honoured": e.get("LOCK_OK") == "yes"},
           "tari_cli_sha256_before": e.get("TARI_BEFORE") or None, "tari_cli_sha256_after": e.get("TARI_AFTER") or None,
           "runner_os": e.get("RUNNER_OS"), "run_url": e.get("RUN_URL"), "error": e.get("err") or None},
          open(sys.argv[1], "w"), indent=2)
PY
ls -la "$OUT"; cat "$OUT/build.json"
exit 0
