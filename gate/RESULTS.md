# OneScan: day-1 gate G1 results (2026-11-23)

| Test | Result |
|---|---|
| A. Reproduce Ootle Split's on-chain bytes (walletd optimizer) | **PASS** |
| B. Reproduce Sealed Bids from its recipe | **BLOCKED** (host disk full mid-toolchain install; not a reproduction failure) |
| C. Read author key + binary from the indexer substate | **PASS** |

## A. PASS
- The user's walletd was `tari_ootle_walletd-0.55.0-b7c964c-windows-x64.exe` (Desktop), tari-ootle tag v0.55.0 = commit b7c964c45d0251c89270739ec1ceaffbfb983e59.
- At that commit, `Cargo.lock` pins wasm-opt 0.116.1 (wasm-opt-sys / wasm-opt-cxx-sys 0.116.0). `applications/tari_walletd/Cargo.toml` uses `wasm-opt = "0.116.1"` with default features.
- Harness: `gate/walletd-opt` copies `wasm_optimizer.rs` exactly: `new_optimize_for_size()` + BulkMemory + ReferenceTypes, with Simd and RelaxedSimd off, then StripDebug, StripProducers and StripTargetFeatuers.
- Source to dist is deterministic. A clean rebuild of Ootle Split (`cargo clean; bash scripts/build.sh`, Windows Git Bash, rustc 1.97.1) gives `0552dbc887d1072d11039b405981d36a5d04369d8d380fb154449b918ad0416e`, the same as `dist/ootle_split.wasm`.
- Commands (WSL Ubuntu, rustc 1.97.1):
  ```
  cd gate/walletd-opt && CARGO_TARGET_DIR=~/ts-target/walletd-opt cargo +1.97.1 build --release   # ~32 min (Binaryen C++)
  walletd-opt ootle-split/dist/ootle_split.wasm /tmp/onescan-a/opt.wasm
  ```
- Output: `67b42d684ee01448b885fe98672019bf823639dac612384e2314bd0261f510ca`, 150,442 bytes.
- On-chain: `67b42d684ee01448b885fe98672019bf823639dac612384e2314bd0261f510ca`. `cmp` finds the files byte-identical.
- The publish ran walletd on Windows, and the harness ran on Linux, so Binaryen's output does not depend on the host OS.

## C. PASS
- Script: `python -I gate/read_template.py <template_hex> [out.wasm]`.
- Request: `GET https://indexer-a.ootle.tari.com/substates/template_<hex>?local_search_only=false`. A non-default User-Agent is required, because Python's default agent gets HTTP 403.
- JSON path: `.state.up.substate`, base64 holding CBOR. Decoded: `[6, [[name:text, author_public_key:bytes32, binary:bytes, epoch:uint]]]`.
  - The author key is at `[1][0][1]`.
  - The WASM is at `[1][0][2]`.
  - Variant tag 6 marks a Template substate.
- Ootle Split (`template_6494a4fe…`):
  - name `Split`
  - author `1a8baa583b0068359004ec094cd06f68b908ccae3bc2d41c46cd7a851e98e862` (matches the known author)
  - binary sha256 `67b42d68…10ca` (matches the receipt)
- Sealed Bids (`template_67a658cc…`):
  - name `SealedBidAuction`
  - author `4c8f96e9f794fbc217a1879348616e088ef8cb529dbaa26aa872a3d426c1b535`
  - binary 202,153 bytes, sha256 `30e204257582696eedb0941b1447bff8ccd7909e7c67bfa74e813f491fb0a6d7` (matches their README)

## B. BLOCKED: environment, not reproduction
- Recipe from the README: rustc 1.99.0, the repo's `Cargo.lock` (commit 252320d), tari-ootle-cli 0.30.0, `RUSTFLAGS="--remap-path-prefix=$CARGO_HOME=/build/.cargo" tari build`.
- In cli 0.30.0, `tari build` is `cargo build --target wasm32-unknown-unknown --release` with size-profile `--config` overrides. It runs no wasm-opt.
- Done in WSL:
  - `rustup toolchain install 1.99.0 --target wasm32-unknown-unknown` succeeded.
  - The repo was cloned.
  - `cargo install tari-ootle-cli --version 0.30.0 --locked` failed partway: C: dropped to 1 MB free, and the WSL root filesystem went read-only with I/O errors.
- To resume: free disk space on C:, run `wsl --shutdown`, then re-run the install and the build. Expected target: sha256 `30e20425…a6d7`.

## Bonus
Not attempted, because B has not passed.
