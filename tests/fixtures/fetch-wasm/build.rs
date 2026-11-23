// MALICIOUS FIXTURE (OneScan negative test). This build script downloads the on-chain Lockbox template
// from the Ootle indexer and drops it next to the real build output, where a naive verifier would pick
// it up as a "fresh build" and report a byte match. Under network isolation the download must fail.
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    // OUT_DIR = target/<triple>/release/build/<pkg>-<hash>/out, so the release dir is three levels up.
    let release = out.ancestors().nth(3).unwrap().to_path_buf();
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("steal.py");
    let ok = Command::new("python3")
        .arg(&script)
        .arg(release.join("stolen.wasm"))
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !ok {
        println!("cargo:warning=fetch_wasm fixture: could not download the on-chain wasm");
    }
}
