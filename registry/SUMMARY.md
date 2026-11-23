# OneScan verification summary

Third-party templates reproduced: **5 / 12**

A match means the sha256 of a fresh build from the named commit equals the template binary in the on-chain substate. It is not an audit.

| Template | Name | Repo @ commit | Mode | On-chain sha256 | Built sha256 | Result | Run |
|---|---|---|---|---|---|---|---|
| `098accfc8e69…` | PublicGrant | feitianbf751026-dotcom/tari-ootle-public-grant-ledger @ `b3e10dd4e0` | walletd-optimized | `8f33a6f4ca34…` | `8f33a6f4ca34…` | MATCH | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45162487226) |
| `4e58dcb438e1…` | SignalForecasts | ogboy92ii/signal-desk @ `b57767562e` | no-match | `7fca4a52b859…` | `4a2a625300a9…` | miss: same ABI, toolchain and paths; code bytes differ (optimizer/profile/dependency drift) (sizes on-chain 126505 vs built 126544) | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45163463051) |
| `54d64fdd5af8…` | Payroll | Devendurance/steady @ `e298436e6f` | walletd-optimized | `f12b2c930bd9…` | `f12b2c930bd9…` | MATCH | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45163463051) |
| `65d9bbc931d3…` | SignalDesk | ogboy92ii/signal-desk @ `b57767562e` | no-match | `c00777517c54…` | `e61cc2ae3ad2…` | miss: same ABI, toolchain and paths; code bytes differ (optimizer/profile/dependency drift) (sizes on-chain 197198 vs built 197274) | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45163463051) |
| `84f1d72f8b9e…` | Semvi | emmaGH1/semvi @ `1896cde493` | walletd-optimized | `7f582b4e3133…` | `7f582b4e3133…` | MATCH | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45163463051) |
| `968740ec9a0f…` | Lockbox | ManishModak/ootle-lockbox @ `ed3ff374ac` | raw | `58033cf4255e…` | `58033cf4255e…` | MATCH | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45163463051) |
| `9b41600aec8a…` | SpecterReportReceipt | yeziR4/specter-tari @ `77bda5ff5c` | no-match | `03efc5252d65…` | `d45942e48a1a…` | miss: leaked paths differ (sizes on-chain 83125 vs built 83133) | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45163463051) |
| `ae13cead3c34…` | GhostlineChannel | AduAkorful/ghostline @ `b9cf4ce77c` | no-match | `273ffbfb4b7f…` | `8e48a9399476…` | miss: leaked paths differ (sizes on-chain 130254 vs built 130214) | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45163463051) |
| `b3628ed057f8…` | GhostlineFeeConfig | AduAkorful/ghostline @ `b9cf4ce77c` | walletd-optimized | `f61a0c297edf…` | `f61a0c297edf…` | MATCH | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45163463051) |
| `b622b0ada7ee…` | SignalFollows | ogboy92ii/signal-desk @ `b57767562e` | no-match | `f3073726e7c3…` | `597298142df3…` | miss: same ABI, toolchain and paths; code bytes differ (optimizer/profile/dependency drift) (sizes on-chain 93069 vs built 93124) | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45163463051) |
| `d4ed44d36e79…` | MoonMail | Seal-Clubber/MoonMail @ `df0da950b4` | no-match | `aff9e0c17b3a…` | `821be5e7db42…` | miss: tari_tdef differs (source/ABI at this commit is not what was published) (sizes on-chain 451979 vs built 544562) | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45163463051) |
| `dc7d2ed8f763…` | CursedPumpkin | Mzee04/cursed-pumpkin @ `04c0f38af8` | no-match | `256af3d16765…` | `1fd99dbdb6f2…` | miss: same ABI, toolchain and paths; code bytes differ (optimizer/profile/dependency drift) (sizes on-chain 275605 vs built 275591) | [run](https://github.com/Techkeyy/onescan-ootle/actions/runs/45163463051) |
