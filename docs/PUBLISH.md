# Publishing the OneScan SourceRegistry on mainnet

## Mainnet deployment (done, all transactions Accepted)

| What | Value |
|---|---|
| SourceRegistry template | `template_5b0efecc709ce6885b69738ce8f774f086ef0c6cb7b2a58920f8bab3e38f8b13` (publish tx [`eda11d8d…`](../evidence/mainnet/tx-eda11d8d940fe6080bf3d6f1dee2b88a2fb4af99f1f663589f30b672819e1004.json)) |
| Registry component | `component_9f72dfb5c6994599299c2498cd17540573edff3b6773a94c6636763abf3153ea` (instantiate tx [`485a8662…`](../evidence/mainnet/tx-485a86626c42397ac09a197d5cc55439cdadeb61be965fbad5d6eb0f6e23f2b9.json)) |
| Attestations tx | [`c86b139b…`](../evidence/mainnet/tx-c86b139b3e04f4eaa9d310020802397c9ba53c41ad5c04f490f3bd30a9a5deec.json): 10 `SourceAttested` events (PublicGrant, Payroll, SourceRegistry, Split, SealedBidAuction, Semvi, Lockbox, SpecterReportReceipt, GhostlineChannel, GhostlineFeeConfig) |
| Trusted verifier public key | `1a8baa583b0068359004ec094cd06f68b908ccae3bc2d41c46cd7a851e98e862` |

Transaction links point to the receipts in [`evidence/mainnet/`](../evidence/mainnet/). The public indexer prunes old
transactions, so explorer transaction pages for these ids no longer resolve. The live proof is the registry component
itself: [on the explorer](https://explorer.tari.mw/substate/component_9f72dfb5c6994599299c2498cd17540573edff3b6773a94c6636763abf3153ea)
(with every `SourceAttested` event) or as the
[raw indexer substate](https://indexer-a.ootle.tari.com/substates/component_9f72dfb5c6994599299c2498cd17540573edff3b6773a94c6636763abf3153ea?local_search_only=false).

OneScan verified its own registry: `registry/5b0efecc709ce6885b69738ce8f774f086ef0c6cb7b2a58920f8bab3e38f8b13.json`
(match, walletd-optimized, run 45205039012).

The website reads the registry component live from the indexer (`web/lib.js`, `ONCHAIN` and
`fetchAttestations`), decodes its state in the browser, and only counts attestations whose verifier is the
trusted key and whose `onchain_sha256` equals the hash of the template bytes the indexer returns.

## Steps (for reference)

These are the human steps. Nothing here is automated, and no script submits a transaction unless you
run it with `--rpc --submit`.

What you publish: `dist/onescan_registry.wasm`. This is the plain cargo output. The wallet runs wasm-opt on it
when publishing, so the on-chain bytes (sha256 `fa009b0a…`) differ from this file; OneScan's self-check compares
the walletd-optimized build.
- sha256 `a5d24edf32f6fb6185010ffd788891eac6684dbeb9a85bd3416c06e3099ec1af`, 149,281 bytes.
- Built by `.github/workflows/registry-ci.yml` (rustc 1.97.1, `tari_template_lib =0.41.0`, paths remapped
  to `/build/.cargo` and `/build/src`). Two CI runs gave the same hash. The engine tests passed in the same
  workflow: `evidence/registry-tests.txt`.
- Check before you publish: `sha256sum dist/onescan_registry.wasm` must print the hash above.

The template has no owner and no admin methods, and it holds no funds. Anyone can call `attest`. The OneScan
UI only counts attestations signed by verifier keys it trusts (step 4).

## 1. Publish the template (Tari Asset Vault)

1. Open the Tari Asset Vault wallet (mainnet). Use the funded account
   `component_bbec55ccd1f4191208a4cb572e87a5b54eeb9c476f200cc12eda5ee26a26a0fc`. You need revealed
   (public) TARI to pay the fee.
2. Go to **Publish Template**, choose `dist/onescan_registry.wasm` and confirm the fee estimate.
3. When the transaction finalizes, copy the new **`template_<hex>`** address and the transaction id.

## 2. Instantiate the component (Manifest page)

1. Open `manifests/create-registry.rs` and replace `REPLACE_WITH_PUBLISHED_TEMPLATE_HEX` with the 64-hex
   template address from step 1 (no `template_` prefix, because the file already has it).
   You can also generate the file: `node scripts/attest.mjs create template_<hex> --out manifests/create-registry.rs`.
2. In the wallet, open **Manifest**, paste the file and set the variable
   `account = component_bbec55ccd1f4191208a4cb572e87a5b54eeb9c476f200cc12eda5ee26a26a0fc`.
3. Submit. In the result, copy the new **`component_<hex>`** for SourceRegistry. That is the registry
   component.

## 3. Submit the attestations for every current match (Manifest page)

1. Regenerate the manifest so it includes every `match: true` result in `registry/` at that moment:
   `node scripts/attest.mjs attest --registry component_<registry hex> --out manifests/attest-all.rs`
   (The committed `manifests/attest-all.rs` covers the 9 matches at the time of writing.)
2. In **Manifest**, paste `manifests/attest-all.rs` and set two variables:
   - `account = component_bbec55ccd1f4191208a4cb572e87a5b54eeb9c476f200cc12eda5ee26a26a0fc`
   - `registry = component_<registry hex>` (from step 2)
3. Submit. It is one transaction with one `attest` call per template. Each call emits a `SourceAttested` event.
   If the wallet refuses because of the fee, raise `pay_fee(...)` at the top of the manifest.

Optional, with a local `tari_ootle_walletd` instead of the UI:
`node scripts/attest.mjs attest --registry component_<hex> --rpc` (dry run with a fee estimate). Add
`--submit` to send it. Set `WALLETD_TOKEN` or `WALLETD_COOKIE` as described in the script header.

## 4. Record the results for OneScan

Keep these, and save each transaction receipt to `evidence/mainnet/tx-<id>.json` (the public indexer prunes old transactions):
- the publish tx id and the `template_<hex>` address
- the instantiate tx id and the registry `component_<hex>`
- the attestations tx id
- the verifier public key. This is the key that signed step 3. The `verifier` field of `get(template)`
  returns it, and so does the `SourceAttested` event in the explorer. The web app trusts only this key.

## 5. OneScan verifies itself

1. In `targets/onescan-registry.json`, replace `REPLACE_WITH_PUBLISHED_TEMPLATE_HEX` with the template hex, then commit.
2. Run it: `gh workflow run verify.yml -R Techkeyy/onescan-ootle -f targets=targets/onescan-registry.json`.
   The recipe rebuilds `registry-template/` at the pinned commit with the same remap flags. The verifier then
   compares the result against the on-chain bytes, both raw and walletd-optimized (`optimizer: auto`).
3. When it reports `match: true`, rerun step 3 with `--only <template hex>`. The registry then carries an
   attestation for itself.
