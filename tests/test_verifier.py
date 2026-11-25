"""Unit tests for the source checks and the registry merge rules. Run: python3 -I tests/test_verifier.py"""
import json, os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "verifier"))
import registry, srccheck  # noqa: E402

F, W = srccheck.check_config, None

# --- hard failures in cargo config
for text, needle in [
    ('[target.wasm32-unknown-unknown]\nlinker = "tools/ld"\n', "linker"),
    ('[target.x86_64-unknown-linux-gnu]\nrunner = "x"\n', "runner"),
    ('[build]\nrustc-wrapper = "w"\n', "rustc-wrapper"),
    ('[build]\nrustc = "r"\n', "build.rustc"),
    ('[build]\nrustflags = ["-C", "link-arg=--whole-archive"]\n', "rustflags"),
    ('[target.wasm32-unknown-unknown]\nrustflags = ["-Clinker=x"]\n', "rustflags"),
    ('[build]\nrustflags = "-L native=blobs -l static=x"\n', "rustflags"),
    ('[source.crates-io]\nreplace-with = "vendored"\n[source.vendored]\ndirectory = "vendor"\n', "[source]"),
    ('[registries.evil]\nindex = "sparse+https://x/"\ncredential-provider = "./x"\n', "credential"),
    ('[target.wasm32-unknown-unknown.foo]\nrustc-link-lib = ["x"]\n', "override"),
    ('include = ["other.toml"]\n', "include"),
    ('paths = ["../x"]\n', "paths"),
    ('[unstable]\nbuild-std = ["std"]\n', "unstable"),
    ('not = valid = toml', "unparseable"),
]:
    fails, _ = F(".cargo/config.toml", text)
    assert any(needle in f for f in fails), (text, fails)
# --- allowed / warning-only
fails, warns = F(".cargo/config.toml", '[build]\ntarget = "wasm32-unknown-unknown"\nrustflags = ["--remap-path-prefix=/a=/b", "-C", "opt-level=z"]\n[alias]\nb = "build"\n[env]\nX = "1"\n')
assert not fails and any("[env]" in w for w in warns), (fails, warns)
# --- toolchain files
assert srccheck.check_toolchain_file("rust-toolchain.toml", '[toolchain]\npath = "/opt/evil"\n')
assert srccheck.check_toolchain_file("rust-toolchain.toml", '[toolchain]\nchannel = "../x"\n')
assert not srccheck.check_toolchain_file("rust-toolchain.toml", '[toolchain]\nchannel = "1.98.1"\ntargets = ["wasm32-unknown-unknown"]\n')
assert not srccheck.check_toolchain_file("rust-toolchain", "nightly-2026-01-01\n")
assert srccheck.check_toolchain_file("rust-toolchain", "/home/x/toolchain\n")
print("srccheck config/toolchain: ok")

# --- full srccheck on a temp repo: nested config at any level, symlink, proc macro, numeric split blob
d = tempfile.mkdtemp()
def w(rel, data, mode="w"):
    p = os.path.join(d, rel); os.makedirs(os.path.dirname(p), exist_ok=True); open(p, mode).write(data)
w("Cargo.toml", '[package]\nname="x"\nversion="0.1.0"\n[lib]\ncrate-type=["cdylib"]\n')
w("src/lib.rs", "")
w("deep/inner/.cargo/config", '[target.wasm32-unknown-unknown]\nlinker = "x"\n')
w("macros/Cargo.toml", '[package]\nname="m"\nversion="0.1.0"\n[lib]\nproc-macro = true\n')
for i in range(10):
    w(f"assets/p{i}.txt", ",".join(str((i * 7 + j) % 256) for j in range(300)))
subprocess.run(["git", "init", "-q"], cwd=d)
if os.name != "nt":
    os.symlink("/etc/passwd", os.path.join(d, "leak"))
subprocess.run(["git", "add", "-A"], cwd=d)
out = os.path.join(d, "..", "sc.json")
srccheck.main(d, d, "-", out)
sc = json.load(open(out))
assert any("deep/inner/.cargo/config" in f for f in sc["fail"]), sc["fail"]
assert sc["proc_macros"], sc
assert any("split-up" in n for n in sc["numeric"]) and any("numeric array" in n for n in sc["numeric"]), sc["numeric"]
if os.name != "nt":
    assert any("symlink" in f for f in sc["fail"]), sc["fail"]
assert sc["build_rs_scope"].startswith("every committed"), "cargo must not run on a repo with a hard failure"
shutil.rmtree(d, ignore_errors=True)
print("srccheck tree: ok")

# --- registry merge: a miss never replaces a match; summary shows the best attempt
reg, new = tempfile.mkdtemp(), tempfile.mkdtemp()
hx = "ab" * 32
def put(base, repo, commit, match, pipeline=2, at="2026-11-25T00:00:00Z", run="r"):
    k = registry.key(repo, commit)
    p = os.path.join(base, "attempts", hx); os.makedirs(p, exist_ok=True)
    json.dump({"template": hx, "name": "T", "repo": repo, "commit": commit, "match": match, "clean": match,
               "mode": "raw" if match else "no-match", "pipeline": pipeline, "verified_at": at, "run_url": run,
               "onchain_sha256": "00" * 32, "warnings": []}, open(os.path.join(p, k + ".json"), "w"))
c1, c2 = "1" * 40, "2" * 40
put(new, "https://github.com/a/b", c1, True, run="good")
registry.apply(new, reg)
shutil.rmtree(new); new = tempfile.mkdtemp()
put(new, "https://github.com/a/b", c1, False, at="2026-11-26T00:00:00Z", run="same-key-miss")
put(new, "https://github.com/evil/fork", c2, False, at="2026-11-26T00:00:00Z", run="other-miss")
registry.apply(new, reg)
top = json.load(open(os.path.join(reg, hx + ".json")))
assert top["match"] and top["run_url"] == "good", top
assert len(top["attempts"]) == 2, top["attempts"]
kept = json.load(open(os.path.join(reg, "attempts", hx, registry.key("https://github.com/a/b", c1) + ".json")))
assert kept["run_url"] == "good", "a miss replaced a match for the same key"
# a hardened (pipeline 2) re-run replaces a pipeline-1 record for the same key, even when it misses
shutil.rmtree(new); new = tempfile.mkdtemp()
put(reg, "https://github.com/c/d", c1, True, pipeline=1, run="old")
put(new, "https://github.com/c/d", c1, False, pipeline=2, run="hardened")
registry.apply(new, reg)
kept = json.load(open(os.path.join(reg, "attempts", hx, registry.key("https://github.com/c/d", c1) + ".json")))
assert kept["run_url"] == "hardened"
print("registry merge: ok")
print("ALL UNIT TESTS PASSED")
