# OneScan (Ootle): director log
Product name: **OneScan** (renamed from Tari Scanner on 2026-11-23). The folder stays `tari-scanner`. The repo will be `Techkeyy/onescan-ootle`, because the Portaldot OneScan project already uses the name.

Contest: Tari November Build Contest: MVP (Council-judged; 1M / 500K / 250K XTM).
**Hard deadline: 2026-12-01 00:00 UTC. Freeze 2026-11-30 22:00 UTC.**
Research: `Desktop/skill/idea-research/tari-ootle-mvp-idea-research.md` (§7–§14 are the build spec; the research calls it "Sourced").
Mode: resource-constrained. Sub-agents build and the director reviews evidence. Commit at checkpoints, with no Claude co-author.

## AUTHORITATIVE STATUS
BUILDING: Phase 2 (feasibility). The day-1 gate has not started.

## Product promise
- **PRODUCT:** Tari Scanner. Verified source for every Ootle template.
- **INTENDED USERS:** people signing Ootle transactions, template builders, the Tari Council/judges, and explorers/wallets.
- **CORE PROBLEM:** on-chain templates are opaque WASM, and nobody can check that a GitHub repo is what is actually deployed.
- **CORE PROMISE:** paste a template address and see, with proof, which public commit builds those exact on-chain bytes and what the code can do with your funds.
- **REAL USER JOURNEY:**
  1. Open the production site and paste a mainnet `template_…` address.
  2. If a verification exists: a green VERIFIED result with the repo@commit, toolchain, recipe, hashes, a one-command re-run, and safety facts (owner, upgradability, fund-moving methods). Plus a link to the on-chain attestation tx.
  3. If none exists: UNVERIFIED, with a form to submit repo + commit. A real verifier run (GitHub Actions) reproduces the build and posts the result plus an on-chain attestation, all without a developer stepping in by hand.
  4. A builder adds the badge/Action to their repo.
  5. The contest board shows all November mainnet templates: reproduced / not reproduced (what's missing) / no source.
- **FINAL OUTCOME:** a user knows from authoritative evidence (on-chain bytes plus a reproducible build) whether a template's source is real before signing.

## Minimum causal loop
template address (+repo/commit) → fetch on-chain WASM from the indexer → infer recipe → reproducible build in a pinned image → hash match → on-chain attestation (SourceRegistry template) → page + badge.

## Claims → mechanism → proof
| Claim | Mechanism | Proof required |
|---|---|---|
| "Verified" means the bytes come from this commit | Rebuild + sha256 equals the indexer's template binary | A byte match on real third-party mainnet templates, with the logs public |
| Works for already-published templates | Inference: tdef version, walletd wasm-opt detection, path-remap prefix | Hit rate on ≥10 third-party templates, published honestly |
| Attestations are on-chain | SourceRegistry template on mainnet | Publish tx + attestation txs on explorer.tari.mw |
| Not an audit | UI copy | "Verified source ≠ safe" shown next to every badge |

## Scope
- **Must:** day-1 gate; builder image + CLI; inference; GH Actions verifier; SourceRegistry template on mainnet; static web app (lookup, result page, board, badge JSON); ≥10 third-party templates attempted.
- **Keep if cheap (affects placing):** safety facts, verify-action for builders, a Sapient PR (adoption signal), badge PRs/issues to other builders.
- **Cut (costs credits, doesn't help place):** source browser, version diffing, Bluesky bot, IPFS archives, multi-verifier quorum, paid tier.

## Gates
- **G1 (day 1):** A) reproduce Ootle Split's on-chain bytes (walletd optimizer); B) reproduce Sealed Bids from its recipe on a clean runner; C) read the author key from the template substate. **All must pass, or STOP and report.** The fallback is Ootle Hooks, and that is the user's call.
- **G2:** verifier CLI + inference reproduce ≥5 third-party templates.
- **G3:** registry template engine-tested, then published by the user's wallet; first attestation on mainnet.
- **G4:** production site; a fresh user completes the journey; cold reviewer pass.
- **G5:** submission truth gate: every claim in the post has a link.

## Log
- 2026-11-23: Project created. Name: Tari Scanner (user's choice). Director brief written.
- 2026-11-23: G1 run. A PASS (walletd 0.55.0 / wasm-opt 0.116.1 reproduces 67b42d68 byte-identical), C PASS (author key at .state.up.substate CBOR [1][0][1]), B BLOCKED (C: disk full mid tari-ootle-cli install). See gate/RESULTS.md. Product renamed OneScan.
- 2026-11-23: G1-B PASS (Sealed Bids raw match in Actions, run 45165847862). Repo Techkeyy/onescan-ootle public with verify.yml + build-tools.yml (walletd-opt built once, release asset). G2: 8/13 third-party templates reproduced (registry/SUMMARY.md). Ootle Split re-run on windows-latest pending (run 45166403297).
- 2026-11-23: G4 web (BUILDER-B): https://techkeyy.github.io/onescan-ootle/ live (lookup with live indexer read + in-browser sha256, VERIFIED / NOT REPRODUCED / UNVERIFIED / MISMATCH states, tari_tdef function list with flags, board 8/13, shields badge JSON, Pages via pages.yml incl. workflow_run after verify). Issue flow: verify-request issue form + workflow; test issue #1 (Lockbox) ran verify 45171800828 and commented VERIFIED. verify.yml build job now read-only token, no persisted creds. Browser acceptance a-e passed.
