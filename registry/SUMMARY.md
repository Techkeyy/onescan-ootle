# OneScan verification summary

Third-party templates reproduced: **1 / 13** (plus Ootle Split, our own)

A match means the sha256 of a fresh build from the named commit equals the template binary in the on-chain substate. It is not an audit.

| Template | Name | Repo @ commit | Mode | On-chain sha256 | Built sha256 | Result | Run |
|---|---|---|---|---|---|---|---|
| `098accfc8e69…` | PublicGrant | feitianbf751026-dotcom/tari-ootle-public-grant-ledger @ `b3e10dd4e0` | walletd-optimized | `8f33a6f4ca34…` | `8f33a6f4ca34…` | MATCH | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45173340424) |
| `4e58dcb438e1…` | SignalForecasts | ogboy92ii/signal-desk @ `b57767562e` | no-match | `7fca4a52b859…` | `-…` | miss: tari build failed | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45173340424) |
| `54d64fdd5af8…` | Payroll | Devendurance/steady @ `e298436e6f` | no-match | `f12b2c930bd9…` | `-…` | miss: cargo build failed | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45173340424) |
| `6494a4fe7ea2…` | Split (own) | Techkeyy/ootle-split @ `93397bf9eb` | no-match | `67b42d684ee0…` | `-…` | miss: build script scripts/build.sh failed | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45173340424) |
| `65d9bbc931d3…` | SignalDesk | ogboy92ii/signal-desk @ `b57767562e` | no-match | `c00777517c54…` | `-…` | miss: tari build failed | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45173340424) |
| `67a658cc6c9e…` | SealedBidAuction | xB0unty911/sealed-bid-auction @ `252320dbca` | no-match | `30e204257582…` | `-…` | miss: tari build failed | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45173340424) |
| `84f1d72f8b9e…` | Semvi | emmaGH1/semvi @ `1896cde493` | no-match | `7f582b4e3133…` | `-…` | miss: cargo build failed | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45173340424) |
| `968740ec9a0f…` | Lockbox | ManishModak/ootle-lockbox @ `ed3ff374ac` | no-match | `58033cf4255e…` | `-…` | miss: cargo build failed | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45173340424) |
| `9b41600aec8a…` | SpecterReportReceipt | yeziR4/specter-tari @ `77bda5ff5c` | no-match | `03efc5252d65…` | `-…` | miss: cargo build failed | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45173340424) |
| `ae13cead3c34…` | GhostlineChannel | AduAkorful/ghostline @ `b9cf4ce77c` | no-match | `273ffbfb4b7f…` | `-…` | miss: build command failed | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45173340424) |
| `b3628ed057f8…` | GhostlineFeeConfig | AduAkorful/ghostline @ `b9cf4ce77c` | no-match | `f61a0c297edf…` | `-…` | miss: cargo build failed | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45173340424) |
| `b622b0ada7ee…` | SignalFollows | ogboy92ii/signal-desk @ `b57767562e` | no-match | `f3073726e7c3…` | `-…` | miss: tari build failed | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45173340424) |
| `d4ed44d36e79…` | MoonMail | Seal-Clubber/MoonMail @ `df0da950b4` | no-match | `aff9e0c17b3a…` | `-…` | miss: cargo build failed | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45173340424) |
| `dc7d2ed8f763…` | CursedPumpkin | Mzee04/cursed-pumpkin @ `04c0f38af8` | no-match | `256af3d16765…` | `-…` | miss: tari build failed | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45173340424) |

## Notes on misses

- Signal Desk (desk, forecasts, follows) and Cursed Pumpkin: the ABI section, rustc commit and leaked paths all match, and both `cargo build` and `tari build` (tari-ootle-cli 0.35.x) give the same bytes, so the walletd optimizer input differs in code only. walletd v0.53-v0.55 use the same wasm-opt 0.116.1 and the same options, so the likely cause is a different commit or Cargo.lock at publish time. Not iterated further.
- MoonMail: the `tari_tdef` section built from `contracts/moonmail-v4` at the public HEAD differs from the published one, so the published source is not at that commit (or not in that directory).
- Recipes are inferred from the binary: rustc from the `/rustc/<commit>` string, the cargo-home remap from leaked registry paths (for example `/home/<user>/.cargo` or `C:/Users/<user>/.cargo` style Windows paths, rebuilt on a Windows runner), and the walletd optimizer from the DataCount section.
