#!/usr/bin/env bash
# Build one recipe from source. Env: R_REPO R_COMMIT R_RUSTC R_BUILDER R_TARI_CLI R_SCRIPT R_WORKDIR
# R_REMAP R_RUSTFLAGS R_OPTIMIZER R_TEMPLATE; OUT (output dir). Writes $OUT/build.json + $OUT/candidates/*.wasm
set -uo pipefail
OUT="${OUT:?}"; mkdir -p "$OUT/candidates"
SRC="${SRC_DIR:-$RUNNER_TEMP/src}"
LOG="$OUT/build.log"
err=""
fail() { err="$1"; echo "ERROR: $1" >&2; }

git clone --quiet "$R_REPO" "$SRC" || fail "git clone failed"
if [ -z "$err" ]; then
  git -C "$SRC" checkout --quiet "$R_COMMIT" || fail "commit $R_COMMIT not found in $R_REPO"
fi
COMMIT_FULL="$(git -C "$SRC" rev-parse HEAD 2>/dev/null || echo "")"
WD="$SRC/${R_WORKDIR:-}"

# Toolchain: recipe override, else rust-toolchain(.toml) found upward from the workdir, else stable.
TC="${R_RUSTC:-}"
if [ -z "$TC" ]; then
  d="$WD"
  while [ -n "$d" ] && [ "$d" != "/" ]; do
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

if [ -z "$err" ]; then
  case "$R_BUILDER" in
    tari-cli)
      if ! command -v tari >/dev/null 2>&1; then
        (unset RUSTFLAGS RUSTUP_TOOLCHAIN; rustup toolchain install stable --profile minimal >/dev/null 2>&1;
         cargo +stable install tari-ootle-cli --version "$R_TARI_CLI" --locked) >>"$LOG" 2>&1 || fail "cargo install tari-ootle-cli $R_TARI_CLI failed"
      fi
      [ -z "$err" ] && { (cd "$WD" && tari build) 2>&1 | tee -a "$LOG"; [ "${PIPESTATUS[0]}" = 0 ] || fail "tari build failed"; } ;;
    cargo)
      (cd "$WD" && cargo build --release --target wasm32-unknown-unknown) 2>&1 | tee -a "$LOG"
      [ "${PIPESTATUS[0]}" = 0 ] || fail "cargo build failed" ;;
    script)
      (cd "$SRC" && bash "$R_SCRIPT") 2>&1 | tee -a "$LOG"
      [ "${PIPESTATUS[0]}" = 0 ] || fail "build script $R_SCRIPT failed" ;;
    cmd)
      (cd "$SRC" && bash -c "$R_CMD") 2>&1 | tee -a "$LOG"
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
export COMMIT_FULL RUSTC_V TARI_V LOCKED err
python -I - "$OUT/build.json" <<'PY'
import json, os, sys
e = os.environ
recipe = {k: e.get("R_" + k.upper(), "") for k in
          ["template", "repo", "commit", "rustc", "builder", "tari_cli", "script", "workdir", "remap", "rustflags", "optimizer", "cmd"]}
json.dump({"recipe": recipe, "commit_full": e.get("COMMIT_FULL"),
           "toolchain": {"rustc": e.get("RUSTC_V"), "rustup_toolchain": e.get("RUSTUP_TOOLCHAIN"),
                         "tari_cli": e.get("TARI_V") or None, "rustflags": e.get("RUSTFLAGS", ""),
                         "cargo_lock_in_repo": e.get("LOCKED") == "yes"},
           "runner_os": e.get("RUNNER_OS"), "run_url": e.get("RUN_URL"), "error": e.get("err") or None},
          open(sys.argv[1], "w"), indent=2)
PY
ls -la "$OUT/candidates"; cat "$OUT/build.json"
exit 0
