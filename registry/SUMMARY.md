# OneScan verification summary

Third-party templates reproduced: **8 / 13** (4 clean, 4 with warnings) (plus our own: SourceRegistry, Split)

A match means the sha256 of a fresh build from the named commit equals the template binary in the on-chain substate. It is not an audit. Each row shows the best attempt for the template; every attempt is kept under `registry/attempts/<template>/`.

| Template | Name | Repo @ commit | Mode | On-chain sha256 | Built sha256 | Result | Warnings | Attempts | Run |
|---|---|---|---|---|---|---|---|---|---|
| `098accfc8e69…` | PublicGrant | feitianbf751026-dotcom/tari-ootle-public-grant-ledger @ `b3e10dd4e0` | walletd-optimized | `8f33a6f4ca34…` | `8f33a6f4ca34…` | MATCH (warnings) | 2 | 1 | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45589482146) |
| `4e58dcb438e1…` | SignalForecasts | ogboy92ii/signal-desk @ `b57767562e` | no-match | `7fca4a52b859…` | `4a2a625300a9…` | miss: same ABI, toolchain and paths; code bytes differ (optimizer/profile/dependency drift) (sizes on-chain 126505 vs built 126544) | 5 | 1 | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45589482146) |
| `54d64fdd5af8…` | Payroll | Devendurance/steady @ `e298436e6f` | walletd-optimized | `f12b2c930bd9…` | `f12b2c930bd9…` | MATCH (warnings) | 1 | 1 | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45589482146) |
| `5b0efecc709c…` | SourceRegistry (own) | Techkeyy/onescan-ootle @ `29a076b8d0` | walletd-optimized | `fa009b0af34c…` | `fa009b0af34c…` | MATCH | 0 | 1 | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45589482146) |
| `6494a4fe7ea2…` | Split (own) | Techkeyy/ootle-split @ `93397bf9eb` | walletd-optimized | `67b42d684ee0…` | `67b42d684ee0…` | MATCH (warnings) | 2 | 1 | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45589482146) |
| `65d9bbc931d3…` | SignalDesk | ogboy92ii/signal-desk @ `b57767562e` | no-match | `c00777517c54…` | `e61cc2ae3ad2…` | miss: same ABI, toolchain and paths; code bytes differ (optimizer/profile/dependency drift) (sizes on-chain 197198 vs built 197274) | 5 | 1 | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45589482146) |
| `67a658cc6c9e…` | SealedBidAuction | xB0unty911/sealed-bid-auction @ `252320dbca` | raw | `30e204257582…` | `30e204257582…` | MATCH | 0 | 1 | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45589482146) |
| `84f1d72f8b9e…` | Semvi | emmaGH1/semvi @ `1896cde493` | walletd-optimized | `7f582b4e3133…` | `7f582b4e3133…` | MATCH (warnings) | 1 | 1 | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45589482146) |
| `968740ec9a0f…` | Lockbox | ManishModak/ootle-lockbox @ `ed3ff374ac` | raw | `58033cf4255e…` | `58033cf4255e…` | MATCH | 0 | 1 | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45589482146) |
| `9b41600aec8a…` | SpecterReportReceipt | yeziR4/specter-tari @ `77bda5ff5c` | walletd-optimized | `03efc5252d65…` | `03efc5252d65…` | MATCH (warnings) | 4 | 1 | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45589482146) |
| `ae13cead3c34…` | GhostlineChannel | AduAkorful/ghostline @ `b9cf4ce77c` | walletd-optimized | `273ffbfb4b7f…` | `273ffbfb4b7f…` | MATCH | 0 | 1 | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45589482146) |
| `b3628ed057f8…` | GhostlineFeeConfig | AduAkorful/ghostline @ `b9cf4ce77c` | walletd-optimized | `f61a0c297edf…` | `f61a0c297edf…` | MATCH | 0 | 1 | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45589482146) |
| `b622b0ada7ee…` | SignalFollows | ogboy92ii/signal-desk @ `b57767562e` | no-match | `f3073726e7c3…` | `597298142df3…` | miss: same ABI, toolchain and paths; code bytes differ (optimizer/profile/dependency drift) (sizes on-chain 93069 vs built 93124) | 5 | 1 | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45589482146) |
| `d4ed44d36e79…` | MoonMail | Seal-Clubber/MoonMail @ `df0da950b4` | no-match | `aff9e0c17b3a…` | `821be5e7db42…` | miss: tari_tdef differs (source/ABI at this commit is not what was published) (sizes on-chain 451979 vs built 544562) | 0 | 1 | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45589482146) |
| `dc7d2ed8f763…` | CursedPumpkin | Mzee04/cursed-pumpkin @ `04c0f38af8` | no-match | `256af3d16765…` | `1fd99dbdb6f2…` | miss: same ABI, toolchain and paths; code bytes differ (optimizer/profile/dependency drift) (sizes on-chain 275605 vs built 275591) | 1 | 1 | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45589482146) |

## Notes on misses

- Signal Desk (desk, forecasts, follows) and Cursed Pumpkin: the ABI section, rustc commit and leaked paths all match, and both `cargo build` and `tari build` (tari-ootle-cli 0.35.x) give the same bytes, so the walletd optimizer input differs in code only. walletd v0.53-v0.55 use the same wasm-opt 0.116.1 and the same options, so the likely cause is a different commit or Cargo.lock at publish time. Not iterated further.
- MoonMail: the `tari_tdef` section built from `contracts/moonmail-v4` at the public HEAD differs from the published one, so the published source is not at that commit (or not in that directory).
- Recipes are inferred from the binary: rustc from the `/rustc/<commit>` string, the cargo-home remap from leaked registry paths (for example `/home/<user>/.cargo` or `C:/Users/<user>/.cargo` style Windows paths, rebuilt on a Windows runner), and the walletd optimizer from the DataCount section.
