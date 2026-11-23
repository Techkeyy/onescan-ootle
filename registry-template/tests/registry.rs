use tari_template_lib::prelude::*;
use tari_template_test_tooling::{
    TemplateTest, byte_type::ToByteType, crypto::RistrettoSecretKey, support::assert_error::assert_reject_reason,
    transaction::args,
};

/// Client-side mirror of the template's `Attestation` (positional CBOR array).
#[derive(Debug, Clone, PartialEq, serde::Deserialize, minicbor::Decode)]
struct Attestation {
    #[n(0)]
    template: String,
    #[n(1)]
    source_sha256: String,
    #[n(2)]
    onchain_sha256: String,
    #[n(3)]
    repo: String,
    #[n(4)]
    commit: String,
    #[n(5)]
    mode: String,
    #[n(6)]
    toolchain: String,
    #[n(7)]
    run_url: String,
    #[n(8)]
    verifier: RistrettoPublicKeyBytes,
    #[n(9)]
    epoch: u64,
}

const T1: &str = "template_67a658cc6c9e1c3564871e378f0a60d0b4f8682222460c34aa852caa961df309";
const T2: &str = "template_968740ec9a0f3d368af2ba48d18af68bbb5c73a30ec582fbf9b00f90cb20ec72";
const H1: &str = "30e204257582696eedb0941b1447bff8ccd7909e7c67bfa74e813f491fb0a6d7";
const H2: &str = "58033cf4255ed932ee9b883373057f4d9792a018b13c5bf75d6f2c8b21fa47a0";

struct Fixture {
    engine: TemplateTest,
    registry: ComponentAddress,
}

fn fields(t: &str, h: &str, commit: &str) -> [String; 8] {
    [
        t.to_string(),
        h.to_string(),
        h.to_string(),
        "https://github.com/xB0unty911/sealed-bid-auction".to_string(),
        commit.to_string(),
        "raw".to_string(),
        "rustc 1.91.1".to_string(),
        "https://github.com/Techkeyy/onescan-ootle/actions/runs/45165847862".to_string(),
    ]
}

impl Fixture {
    fn new() -> Self {
        let mut engine = TemplateTest::new(env!("CARGO_MANIFEST_DIR"), ["."]);
        let registry: ComponentAddress = engine.call_function("SourceRegistry", "new", args![], vec![]);
        Self { engine, registry }
    }

    fn key(&mut self) -> (RistrettoPublicKeyBytes, RistrettoSecretKey) {
        let (_, public, secret) = self.engine.create_owner_proof();
        (public.to_byte_type(), secret)
    }

    fn attest_tx(&mut self, f: [String; 8], key: &RistrettoSecretKey) -> tari_template_test_tooling::transaction::Transaction {
        let [a, b, c, d, e, g, h, i] = f;
        self.engine
            .transaction()
            .call_method(self.registry, "attest", args![a, b, c, d, e, g, h, i])
            .build_and_seal(key)
    }

    fn attest(&mut self, f: [String; 8], key: &RistrettoSecretKey) {
        let tx = self.attest_tx(f, key);
        self.engine.execute_expect_success(tx, vec![]);
    }

    fn get(&mut self, t: &str) -> Vec<Attestation> {
        self.engine.call_method(self.registry, "get", args![t.to_string()], vec![])
    }

    fn count(&mut self) -> u64 {
        self.engine.call_method(self.registry, "count", args![], vec![])
    }
}

#[test]
fn attest_and_read_back() {
    let mut f = Fixture::new();
    let (pk, sk) = f.key();
    assert_eq!(f.count(), 0);
    assert!(f.get(T1).is_empty());
    f.attest(fields(T1, H1, "252320dbca"), &sk);
    let got = f.get(T1);
    assert_eq!(got.len(), 1);
    let a = &got[0];
    assert_eq!(a.template, T1);
    assert_eq!(a.source_sha256, H1);
    assert_eq!(a.onchain_sha256, H1);
    assert_eq!(a.repo, "https://github.com/xB0unty911/sealed-bid-auction");
    assert_eq!(a.commit, "252320dbca");
    assert_eq!(a.mode, "raw");
    assert_eq!(a.toolchain, "rustc 1.91.1");
    assert!(a.run_url.ends_with("/45165847862"));
    assert_eq!(a.verifier, pk, "verifier must be the transaction signer");
    assert_eq!(f.count(), 1);
    let templates: Vec<String> = f.engine.call_method(f.registry, "templates", args![], vec![]);
    assert_eq!(templates, vec![T1.to_string()]);
    println!("PROOF attest+read: template={} verifier={} epoch={}", a.template, a.verifier, a.epoch);
}

#[test]
fn multiple_attestations_per_template() {
    let mut f = Fixture::new();
    let (pk1, sk1) = f.key();
    let (pk2, sk2) = f.key();
    f.attest(fields(T1, H1, "252320dbca"), &sk1);
    f.attest(fields(T1, H1, "252320dbca"), &sk2);
    f.attest(fields(T2, H2, "ed3ff374ac"), &sk1);
    let got = f.get(T1);
    assert_eq!(got.len(), 2);
    assert_eq!(got[0].verifier, pk1);
    assert_eq!(got[1].verifier, pk2);
    assert_eq!(f.get(T2).len(), 1);
    assert_eq!(f.count(), 3);

    // The same verifier re-attesting replaces its own entry instead of appending.
    let mut updated = fields(T1, H1, "252320dbcafe");
    updated[5] = "walletd-optimized".to_string();
    f.attest(updated, &sk1);
    let got = f.get(T1);
    assert_eq!(got.len(), 2);
    assert_eq!(got[0].commit, "252320dbcafe");
    assert_eq!(got[0].mode, "walletd-optimized");
    assert_eq!(f.count(), 3);
    println!("PROOF multi: T1 has {} verifiers, total {}", got.len(), 3);
}

#[test]
fn invalid_fields_are_rejected() {
    let mut f = Fixture::new();
    let (_, sk) = f.key();
    let long = |n: usize| format!("https://{}", "a".repeat(n));
    let mut cases: Vec<([String; 8], &str)> = Vec::new();
    let mut c = |i: usize, v: String, reason: &'static str| {
        let mut x = fields(T1, H1, "252320dbca");
        x[i] = v;
        cases.push((x, reason));
    };
    c(0, "template_67a6".to_string(), "InvalidTemplate");
    c(0, T1.replace("template_", "component"), "InvalidTemplate");
    c(0, T1.to_uppercase(), "InvalidTemplate");
    c(1, H1[..63].to_string(), "InvalidSourceSha256");
    c(2, format!("{}0", H1), "InvalidOnchainSha256");
    c(2, H2.to_string(), "HashMismatch");
    c(3, String::new(), "InvalidRepo");
    c(3, long(200), "InvalidRepo");
    c(3, "http://github.com/x/y".to_string(), "InvalidRepo");
    c(4, "abc".to_string(), "InvalidCommit");
    c(4, "z".repeat(10), "InvalidCommit");
    c(4, "a".repeat(65), "InvalidCommit");
    c(5, "optimized".to_string(), "InvalidMode");
    c(6, "x".repeat(65), "InvalidToolchain");
    c(6, "rustc 1.91".replace(' ', "\n"), "InvalidToolchain");
    c(7, long(200), "InvalidRunUrl");
    c(7, String::new(), "InvalidRunUrl");
    let n = cases.len();
    for (x, reason) in cases {
        let tx = f.attest_tx(x, &sk);
        assert_reject_reason(f.engine.execute_expect_failure(tx, vec![]), reason);
    }
    assert_eq!(f.count(), 0);
    println!("PROOF validation: {} invalid inputs rejected", n);
}

#[test]
fn per_template_cap() {
    let mut f = Fixture::new();
    for _ in 0..32 {
        let (_, sk) = f.key();
        f.attest(fields(T1, H1, "252320dbca"), &sk);
    }
    assert_eq!(f.get(T1).len(), 32);
    let (_, sk) = f.key();
    let tx = f.attest_tx(fields(T1, H1, "252320dbca"), &sk);
    assert_reject_reason(f.engine.execute_expect_failure(tx, vec![]), "TooManyAttestations");
}
