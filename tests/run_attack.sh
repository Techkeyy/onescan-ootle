#!/usr/bin/env bash
# Run one attack fixture through the real pipeline: verifier/build.sh (the build job), then
# verifier/record.py (the trusted record job), plus a "legacy" compare that trusts the artifact's metadata
# the way the pre-hardening record job did.
# Usage: tests/run_attack.sh <attack dir under tests/attacks> <mode> <work dir>
#   mode: isolated        the production path
#         control         isolation disabled (ONESCAN_SELFTEST_NO_ISOLATION)
#         legacy-unshare  the pre-hardening netns isolation, sudo still available
#         allow-config    production isolation, but cargo-config hard failures demoted (srccheck switch)
set -euo pipefail
ATTACK="$1"; MODE="$2"; W="$3"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCKBOX="968740ec9a0f3d368af2ba48d18af68bbb5c73a30ec582fbf9b00f90cb20ec72"
ID="${LOCKBOX:0:12}-0"
rm -rf "$W"; mkdir -p "$W"
FIX="$RUNNER_TEMP/fixture-$ATTACK-$MODE"
rm -rf "$FIX"; cp -r "$HERE/tests/attacks/$ATTACK" "$FIX"

python3 -I "$HERE/verifier/onchain.py" "$LOCKBOX" "$W/onchain" > /dev/null
if [ -f "$FIX/data/GENERATE" ]; then
  # attack C: split the on-chain bytes into many small comma-separated decimal files
  python3 -I - "$W/onchain/onchain.wasm" "$FIX/data" <<'PY'
import os, sys
b = open(sys.argv[1], "rb").read()
n = 40
step = -(-len(b) // n)
for i in range(n):
    chunk = b[i * step:(i + 1) * step]
    lines = [",".join(str(x) for x in chunk[j:j + 32]) for j in range(0, len(chunk), 32)]
    open(os.path.join(sys.argv[2], f"part-{i:02d}.txt"), "w").write(",\n".join(lines) + "\n")
print(f"wrote {n} decimal parts for {len(b)} bytes")
PY
  rm "$FIX/data/GENERATE"
fi
chmod +x "$FIX"/tools/* 2>/dev/null || true
(cd "$FIX" && git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm fixture)
COMMIT="$(git -C "$FIX" rev-parse HEAD)"

OUT="$W/out"; mkdir -p "$OUT"
# The pre-hardening artifact layout: on-chain metadata and source checks next to the build output.
cp "$W/onchain/onchain.json" "$OUT/onchain.json"
printf '{"fail": [], "build_rs": ["build.rs (package fixture)"], "blobs": []}\n' > "$OUT/source_check.json"
sha256sum "$OUT/onchain.json" "$OUT/source_check.json" > "$W/meta.sha256"

TOOLS="$W/tools"; mkdir -p "$TOOLS/bin"
# stand-in for tari-ootle-cli (attack D uses builder tari-cli): runs the same cargo build tari build runs
printf '#!/bin/sh\n[ "$1" = "--version" ] && { echo "tari-ootle-cli stand-in (selftest)"; exit 0; }\nexec cargo build --release --target wasm32-unknown-unknown --offline\n' > "$TOOLS/bin/tari"
chmod +x "$TOOLS/bin/tari"
BUILDER=cargo; [ -f "$FIX/USE_TARI_CLI" ] && BUILDER=tari-cli

case "$MODE" in
  isolated) ;;
  control) export ONESCAN_SELFTEST_NO_ISOLATION=1 ;;
  legacy-unshare) export ONESCAN_SELFTEST_LEGACY_UNSHARE=1 ;;
  allow-config) export ONESCAN_SELFTEST_ALLOW_CARGO_CONFIG=1 ;;
  *) echo "unknown mode $MODE"; exit 2 ;;
esac
echo "::group::build.sh ($ATTACK, $MODE)"
OUT="$OUT" SRC_DIR="$RUNNER_TEMP/src-$ATTACK-$MODE" TOOLS_DIR="$TOOLS" ONCHAIN_JSON="$W/onchain/onchain.json" \
  R_REPO="$FIX" R_COMMIT="$COMMIT" R_BUILDER="$BUILDER" R_TARI_CLI=0.0.0 R_RUSTC=stable R_REMAP=none \
  R_TEMPLATE="$LOCKBOX" R_OPTIMIZER=off R_SCRIPT="" R_CMD="" R_WORKDIR="" R_RUSTFLAGS="" \
  bash "$HERE/verifier/build.sh"
echo "::endgroup::"
sleep 6  # anything the build left running gets the time an artifact upload step would give it

mkdir -p "$W/artifacts"; cp -r "$OUT" "$W/artifacts/build-$ID"
python3 -I - "$W/matrix.json" "$FIX" "$COMMIT" "$BUILDER" "$ID" <<'PY'
import json, sys
p, repo, commit, builder, rid = sys.argv[1:6]
t = {"template": "968740ec9a0f3d368af2ba48d18af68bbb5c73a30ec582fbf9b00f90cb20ec72", "repo": repo, "commit": commit,
     "rustc": "stable", "builder": builder, "tari_cli": "0.0.0", "script": "", "workdir": "", "remap": "none",
     "rustflags": "", "optimizer": "off", "os": "ubuntu-latest", "cmd": "", "id": rid}
json.dump({"include": [t]}, open(p, "w"))
json.dump(t, open(p.replace("matrix.json", "recipe.json"), "w"))
PY
echo "::group::record.py (trusted)"
RUSTUP_TOOLCHAIN=stable python3 -I "$HERE/verifier/record.py" "$W/matrix.json" "$W/artifacts" - "$W/mine" || true
cp "$W"/mine/attempts/*/*.json "$W/record.json"
echo "::endgroup::"
A="$W/artifacts/build-$ID"
python3 -I "$HERE/verifier/compare.py" --onchain "$A/onchain.json" --candidate "$A/candidate.wasm" --build "$A/build.json" \
  --source-check "$A/source_check.json" --recipe "$W/recipe.json" --out "$W/legacy.json" || true
grep -E "network isolated|probe|attack [abcd]:|rejected by|ERROR" "$OUT/build.log" || true
