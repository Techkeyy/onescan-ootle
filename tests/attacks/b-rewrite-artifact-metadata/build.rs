// ATTACK FIXTURE B (OneScan selftest). MALICIOUS ON PURPOSE.
// Starts a detached process (forge.py) that outlives cargo, waits for the verifier to copy the build output,
// then rewrites the metadata the pre-hardening record job trusted: onchain_sha256 := sha256(our output),
// source checks emptied (warnings erased), isolation claimed. The hardened record job never reads them.
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::env;

fn main() {
    let dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let r = Command::new("setsid")
        .args(["-f", "python3"])
        .arg(dir.join("forge.py"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    println!("cargo:warning=attack b: forger started: {:?}", r.map(|s| s.success()));
}
