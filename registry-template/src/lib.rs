//! OneScan SourceRegistry: on-chain source-verification attestations for Tari Ootle templates.
//!
//! A verifier rebuilds a template from a public repo@commit and, when the sha256 of the build
//! equals the on-chain template binary, calls `attest`. The registry records who attested
//! (the transaction signer's public key), what was built and where the run log lives.
//!
//! Anyone may attest. The registry does not decide who to trust: readers (the OneScan UI)
//! filter attestations by verifier keys they trust, and anyone can re-run the recipe.
//! One verifier key holds at most one attestation per template; re-attesting replaces it.
//! The component has no owner, no admin methods and holds no funds.
use std::collections::BTreeMap;

use tari_template_lib::prelude::*;

pub const HEX_HASH_LEN: usize = 64;
pub const MAX_REPO_LEN: usize = 200;
pub const MIN_COMMIT_LEN: usize = 7;
pub const MAX_COMMIT_LEN: usize = 64;
pub const MAX_TOOLCHAIN_LEN: usize = 64;
pub const MAX_RUN_URL_LEN: usize = 200;
pub const MAX_ATTESTATIONS_PER_TEMPLATE: usize = 32;
pub const TEMPLATE_PREFIX: &str = "template_";

fn is_lower_hex(s: &str) -> bool {
    s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// `template_<64 lowercase hex>`.
pub fn valid_template(s: &str) -> bool {
    s.len() == TEMPLATE_PREFIX.len() + HEX_HASH_LEN
        && s.starts_with(TEMPLATE_PREFIX)
        && is_lower_hex(&s[TEMPLATE_PREFIX.len()..])
}

pub fn valid_sha256(s: &str) -> bool {
    s.len() == HEX_HASH_LEN && is_lower_hex(s)
}

pub fn valid_commit(s: &str) -> bool {
    (MIN_COMMIT_LEN..=MAX_COMMIT_LEN).contains(&s.len()) && is_lower_hex(s)
}

fn valid_text(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s.bytes().all(|b| (0x20..0x7f).contains(&b))
}

#[template]
mod registry {
    use super::*;

    pub struct SourceRegistry {
        /// template address string -> attestations (at most one per verifier key)
        attestations: BTreeMap<String, Vec<Attestation>>,
        total: u64,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct Attestation {
        pub template: String,
        /// sha256 of the wasm built from repo@commit
        pub source_sha256: String,
        /// sha256 of the on-chain template binary
        pub onchain_sha256: String,
        pub repo: String,
        pub commit: String,
        /// "raw" or "walletd-optimized"
        pub mode: String,
        pub toolchain: String,
        pub run_url: String,
        /// public key of the transaction signer that attested
        pub verifier: RistrettoPublicKeyBytes,
        pub epoch: u64,
    }

    impl SourceRegistry {
        pub fn new() -> Component<Self> {
            Component::new(Self { attestations: BTreeMap::new(), total: 0 })
                .with_owner_rule(OwnerRule::None)
                .with_access_rules(AccessRules::allow_all())
                .create()
        }

        /// Record that `source_sha256` (built from repo@commit) reproduces `template`.
        pub fn attest(
            &mut self,
            template: String,
            source_sha256: String,
            onchain_sha256: String,
            repo: String,
            commit: String,
            mode: String,
            toolchain: String,
            run_url: String,
        ) {
            assert!(valid_template(&template), "InvalidTemplate");
            assert!(valid_sha256(&source_sha256), "InvalidSourceSha256");
            assert!(valid_sha256(&onchain_sha256), "InvalidOnchainSha256");
            assert!(source_sha256 == onchain_sha256, "HashMismatch");
            assert!(valid_text(&repo, MAX_REPO_LEN) && repo.starts_with("https://"), "InvalidRepo");
            assert!(valid_commit(&commit), "InvalidCommit");
            assert!(mode == "raw" || mode == "walletd-optimized", "InvalidMode");
            assert!(valid_text(&toolchain, MAX_TOOLCHAIN_LEN), "InvalidToolchain");
            assert!(valid_text(&run_url, MAX_RUN_URL_LEN) && run_url.starts_with("https://"), "InvalidRunUrl");

            let verifier = CallerContext::transaction_signer_public_key();
            let epoch = Consensus::current_epoch();
            emit_event("SourceAttested", [
                ("template", template.clone()),
                ("source_sha256", source_sha256.clone()),
                ("repo", repo.clone()),
                ("commit", commit.clone()),
                ("mode", mode.clone()),
                ("verifier", verifier.to_string()),
            ]);
            let a = Attestation {
                template: template.clone(),
                source_sha256,
                onchain_sha256,
                repo,
                commit,
                mode,
                toolchain,
                run_url,
                verifier,
                epoch,
            };
            let list = self.attestations.entry(template).or_default();
            if let Some(existing) = list.iter_mut().find(|x| x.verifier == verifier) {
                *existing = a;
            } else {
                assert!(list.len() < MAX_ATTESTATIONS_PER_TEMPLATE, "TooManyAttestations");
                list.push(a);
                self.total += 1;
            }
        }

        pub fn get(&self, template: String) -> Vec<Attestation> {
            self.attestations.get(&template).cloned().unwrap_or_default()
        }

        /// Number of stored attestations across all templates.
        pub fn count(&self) -> u64 {
            self.total
        }

        /// Attested template addresses.
        pub fn templates(&self) -> Vec<String> {
            self.attestations.keys().cloned().collect()
        }
    }
}
