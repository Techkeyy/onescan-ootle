"""Assertions for tests/run_attack.sh. Usage: python3 -I tests/assert_attack.py <attack> <mode> <work dir> <repo root>

Production modes must block the attack; control modes (defence switched off) must show the attack is real.
"""
import hashlib, json, os, sys

attack, mode, w, root = sys.argv[1:5]
ld = lambda p: json.load(open(p)) if os.path.exists(p) else {}  # noqa: E731
rec = ld(os.path.join(w, "record.json"))
legacy = ld(os.path.join(w, "legacy.json"))
art = os.path.join(w, "artifacts", "build-968740ec9a0f-0")
build = ld(os.path.join(art, "build.json"))
log = open(os.path.join(w, "out", "build.log"), errors="replace").read()
iso = build.get("isolation") or {}
print(f"== {attack} / {mode}")
print("record :", {k: rec.get(k) for k in ("match", "mode", "clean", "onchain_sha256", "built_sha256")})
print("  warnings:", rec.get("warnings"))
print("  fail    :", (rec.get("source_check") or {}).get("fail"))
print("legacy :", {k: legacy.get(k) for k in ("match", "mode", "clean", "onchain_sha256")})
print("build  :", {"error": build.get("error"), "isolation": iso,
                   "tari": (build.get("tari_cli_sha256_before"), build.get("tari_cli_sha256_after"))})
LOCKBOX_SHA = "58033cf4255e"  # prefix of the real on-chain sha256 (registry record)
assert rec, "no record written"
assert rec["template"].startswith("968740ec9a0f"), "record template is not the matrix template"
assert rec["onchain_sha256"].startswith(LOCKBOX_SHA), "record on-chain hash is not the indexer's"


def fail(msg):
    raise SystemExit("FAIL: " + msg)


if attack.startswith("a-"):
    if mode == "isolated":
        assert "attack a: fetch via none" in log, "fixture did not report a blocked fetch"
        assert iso.get("network_isolated") is True, "build not isolated"
        assert "REACHED" not in (iso.get("note") or ""), "an isolation probe reached its target"
        rec["match"] and fail("isolated build was fooled (sudo nsenter / network fetch)")
        print("PASS: no network, no sudo, read-only toolchain: the fetch and the rust-lld shim both failed; no match")
    else:  # legacy-unshare: proves the bypass of the old design is real
        assert "fetch via sudo nsenter" in log or "fetch via direct" in log, "attack did not get the bytes in the control"
        rec["match"] or fail("control: the attack should produce a fake match under the legacy namespace")
        print("PASS (control): under the old unshare design the sudo nsenter bypass fakes a match")
elif attack.startswith("b-"):
    forged = os.path.exists(os.path.join(art, "FORGED"))
    rec["match"] and fail("trusted record was fooled by rewritten metadata")
    if mode == "isolated":
        forged and fail("the forger reached the artifact from inside the container")
        same = open(os.path.join(w, "meta.sha256")).read().split()
        h = hashlib.sha256(open(os.path.join(art, "onchain.json"), "rb").read()).hexdigest()
        assert h == same[0], "artifact onchain.json changed during an isolated build"
        print("PASS: the build could not reach the metadata, and the record job ignores it anyway")
    else:
        forged or fail("control: the forger should have rewritten the metadata without isolation")
        (legacy.get("match") and legacy.get("clean")) or fail("control: legacy trust model should be fooled")
        print("PASS (control): rewritten metadata fakes a clean match under the old trust model; "
              "the hardened record job still says no match")
elif attack.startswith("c-"):
    if mode == "isolated":
        assert rec["mode"] == "rejected", "cargo config linker was not rejected"
        assert any("linker" in f for f in rec["source_check"]["fail"]), "linker not named in the failure"
        assert any(w_.startswith("numeric data") for w_ in rec["warnings"]), "split decimal blobs not flagged"
        assert "rejected by source checks" in (build.get("error") or ""), "build job did not refuse to build"
        rec["match"] and fail("rejected record reported a match")
        print("PASS: .cargo/config linker is a hard failure (build refused, record rejected); split blobs flagged")
    else:  # allow-config: the check switched off, isolation still on
        rec["match"] or fail("control: with the config check off the linker should fake a match")
        print("PASS (control): with the config check off the linker fakes a match even inside the isolated container")
elif attack.startswith("d-"):
    before, after = build.get("tari_cli_sha256_before"), build.get("tari_cli_sha256_after")
    assert before, "tari hash not recorded"
    planted = os.path.exists(os.path.join(os.environ.get("CARGO_HOME", os.path.expanduser("~/.cargo")), "bin", "tari"))
    if mode == "isolated":
        assert before == after, "tari-ootle-cli changed during an isolated build"
        planted and fail("a tari binary was planted in CARGO_HOME/bin")
        assert "POISONED" not in log, "a poison write succeeded"
        wf = open(os.path.join(root, ".github", "workflows", "verify.yml")).read()
        assert "actions/cache" not in wf, "verify.yml caches a binary across runs"
        print("PASS: CLI and cargo home are read-only to the build; no cache to poison")
    else:
        assert before != after, "control: the poison should have replaced the CLI without isolation"
        assert any("tari-ootle-cli binary changed" in x for x in rec["warnings"]), "record did not flag the change"
        print("PASS (control): without isolation the CLI is overwritten (and the record flags it)")
else:
    fail("unknown attack")
