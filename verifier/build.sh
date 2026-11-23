#!/usr/bin/env bash
# Build one recipe from source. Env: R_REPO R_COMMIT R_RUSTC R_BUILDER R_TARI_CLI R_SCRIPT R_WORKDIR
# R_REMAP R_RUSTFLAGS R_OPTIMIZER R_TEMPLATE; OUT (output dir). Writes $OUT/build.json + $OUT/candidates/*.wasm
set -uo pipefail
OUT="${OUT:?}"; mkdir -p "$OUT/candidates"
SRC="${SRC_DIR:-$RUNNER_TEMP/src}"
SRC="$(cygpath -u "$SRC" 2>/dev/null || echo "$SRC")"
LOG="$OUT/build.log"
err=""
fail() { err="$1"; echo "ERROR: $1" >&2; }

# The on-chain binary must not be on disk while untrusted build code runs (it could just copy it).
rm -f "$OUT/onchain.wasm"
git clone --quiet "$R_REPO" "$SRC" || fail "git clone failed"
if [ -z "$err" ]; then
  git -C "$SRC" checkout --quiet "$R_COMMIT" || fail "commit $R_COMMIT not found in $R_REPO"
fi
COMMIT_FULL="$(git -C "$SRC" rev-parse HEAD 2>/dev/null || echo "")"
WD="$SRC${R_WORKDIR:+/$R_WORKDIR}"

# Toolchain: recipe override, else rust-toolchain(.toml) found upward from the workdir, else stable.
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
echo "toolchain: $TC"
rustup toolchain install "$TC" --profile minimal --target wasm32-unknown-unknown >>"$LOG" 2>&1 || fail "rustup install $TC failed"
export RUSTUP_TOOLCHAIN="$TC"

CH="${CARGO_HOME:-$HOME/.cargo}"
CH_NATIVE="$(cygpath -w "$CH" 2>/dev/null || echo "$CH")"
SRC_NATIVE="$(cygpath -w "$SRC" 2>/dev/null || echo "$SRC")"
if [ -n "${R_RUSTFLAGS:-}" ]; then
  RF="${R_RUSTFLAGS//\{CARGO_HOME\}/"$CH_NATIVE"}"; RF="${RF//\{SRC\}/"$SRC_NATIVE"}"
  export RUSTFLAGS="$RF"
elif [ "${R_REMAP:-/build/.cargo}" != "none" ]; then
  export RUSTFLAGS="--remap-path-prefix=$CH_NATIVE=${R_REMAP:-/build/.cargo}"
fi
echo "RUSTFLAGS=${RUSTFLAGS:-}"
LOCKED="no"; [ -f "$WD/Cargo.lock" ] || [ -f "$SRC/Cargo.lock" ] && LOCKED="yes"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1) Fetch every dependency while the network is still available (lockfile honoured when present).
LOCK_OK="yes"; FETCH_DIRS="$WD"
while IFS= read -r l; do FETCH_DIRS="$FETCH_DIRS"$'\n'"$SRC/$(dirname "$l")"; done < <(git -C "$SRC" ls-files '*Cargo.lock' 2>/dev/null)
if [ -z "$err" ]; then
  while IFS= read -r d; do
    [ -f "$d/Cargo.toml" ] || continue
    (cd "$d" && env -u RUSTFLAGS cargo fetch --locked) >>"$LOG" 2>&1 || { LOCK_OK="no"; (cd "$d" && env -u RUSTFLAGS cargo fetch) >>"$LOG" 2>&1 || echo "cargo fetch failed in $d" | tee -a "$LOG"; }
  done < <(printf '%s\n' "$FETCH_DIRS" | sort -u)
fi

# 2) Static source checks; delete committed *.wasm and any committed copy of the on-chain binary.
python -I "$HERE/srccheck.py" "$SRC" "$WD" "$OUT/onchain.json" "$OUT/source_check.json" | tee -a "$LOG" || echo '{}' > "$OUT/source_check.json"

# 3) The build itself runs with no network (Linux: a fresh network namespace) and cargo offline.
export CARGO_NET_OFFLINE=true
ISOLATED="no"; ISO_NOTE=""
iso() { "$@"; }
if [ "${RUNNER_OS:-}" = "Linux" ] && [ -z "${ONESCAN_SELFTEST_NO_ISOLATION:-}" ]; then
  _U="$(id -u)"; _G="$(id -g)"
  ENVF="${RUNNER_TEMP:-/tmp}/onescan-build-env.sh"
  # sudo drops the environment, so snapshot the exported variables and restore them inside the namespace.
  iso() { export -p > "$ENVF"; sudo unshare --net -- setpriv --reuid="$_U" --regid="$_G" --init-groups --           bash -c 'source "$1" 2>/dev/null; shift; exec "$@"' _ "$ENVF" "$@"; }
  if ! iso true 2>>"$LOG"; then
    iso() { "$@"; }; ISO_NOTE="could not create a network namespace on this runner"
  elif iso curl -sS --max-time 8 -o /dev/null https://indexer-a.ootle.tari.com/ 2>/dev/null; then
    ISO_NOTE="probe reached the indexer from inside the namespace"
  elif curl -sS --max-time 15 -o /dev/null https://indexer-a.ootle.tari.com/ 2>/dev/null; then
    ISOLATED="yes"; ISO_NOTE="Linux network namespace; probe to the indexer failed inside, succeeded outside"
  else
    ISO_NOTE="indexer unreachable from the runner too, isolation probe inconclusive"
  fi
else
  ISO_NOTE="${RUNNER_OS:-unknown} runner: build ran with cargo offline but without network isolation"
fi
echo "network isolated: $ISOLATED ($ISO_NOTE)" | tee -a "$LOG"
LOCKFLAG=""; [ "$LOCK_OK" = yes ] && [ "$LOCKED" = yes ] && LOCKFLAG="--locked"
export WD SRC R_SCRIPT R_CMD LOCKFLAG

if [ -z "$err" ]; then
  case "$R_BUILDER" in
    tari-cli)
      if ! command -v tari >/dev/null 2>&1; then
        (unset RUSTFLAGS RUSTUP_TOOLCHAIN CARGO_NET_OFFLINE; rustup toolchain install stable --profile minimal >/dev/null 2>&1;
         cargo +stable install tari-ootle-cli --version "$R_TARI_CLI" --locked) >>"$LOG" 2>&1 || fail "cargo install tari-ootle-cli $R_TARI_CLI failed"
      fi
      [ -z "$err" ] && { iso bash -c 'cd "$WD" && tari build' 2>&1 | tee -a "$LOG"; [ "${PIPESTATUS[0]}" = 0 ] || fail "tari build failed"; } ;;
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

n=0
while IFS= read -r f; do
  n=$((n+1)); cp "$f" "$OUT/candidates/$(basename "$f" .wasm)__$n.wasm"
done < <(find "$SRC" -path '*/wasm32-unknown-unknown/release/*.wasm' -not -path '*/deps/*' -not -path '*/build/*' 2>/dev/null)
[ "$n" = 0 ] && [ -z "$err" ] && fail "build produced no wasm"

RUSTC_V="$(rustc -V 2>/dev/null || echo unknown)"
TARI_V="$( [ "$R_BUILDER" = tari-cli ] && (tari --version 2>/dev/null || echo "tari-ootle-cli $R_TARI_CLI") || echo "")"
export COMMIT_FULL RUSTC_V TARI_V LOCKED err ISOLATED ISO_NOTE LOCK_OK
python -I - "$OUT/build.json" <<'PY'
import json, os, sys
e = os.environ
recipe = {k: e.get("R_" + k.upper(), "") for k in
          ["template", "repo", "commit", "rustc", "builder", "tari_cli", "script", "workdir", "remap", "rustflags", "optimizer", "cmd"]}
json.dump({"recipe": recipe, "commit_full": e.get("COMMIT_FULL"),
           "toolchain": {"rustc": e.get("RUSTC_V"), "rustup_toolchain": e.get("RUSTUP_TOOLCHAIN"),
                         "tari_cli": e.get("TARI_V") or None, "rustflags": e.get("RUSTFLAGS", ""),
                         "cargo_lock_in_repo": e.get("LOCKED") == "yes"},
           "isolation": {"network_isolated": e.get("ISOLATED") == "yes", "note": e.get("ISO_NOTE"),
                         "cargo_offline": True, "lockfile_honoured": e.get("LOCK_OK") == "yes"},
           "runner_os": e.get("RUNNER_OS"), "run_url": e.get("RUN_URL"), "error": e.get("err") or None},
          open(sys.argv[1], "w"), indent=2)
PY
ls -la "$OUT/candidates"; cat "$OUT/build.json"
exit 0
