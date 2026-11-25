"""Trusted record step: turn build artifacts into registry records without trusting anything the build wrote
except the candidate wasm bytes.

Usage: python -I verifier/record.py <matrix.json> <artifacts_dir> <walletd_opt|-> <out_dir>

For every recipe in the plan matrix (trusted input):
  1. validate the template id (64 hex) and re-fetch the on-chain template from the indexer here
  2. clone repo@commit afresh (not the build's tree) and run srccheck on it (hard checks first; cargo is
     never run on a repo with a hostile cargo config)
  3. compute the expected output path of the template crate (cargo metadata --no-deps on the fresh clone)
  4. take ONLY <artifacts>/build-<id>/candidate.wasm (regular file, size-capped); build.json is read for
     information only and can downgrade, never upgrade, the isolation verdict
  5. compare, and write <out_dir>/attempts/<template>/<key>.json, named from the trusted template id
No code from the verified repo runs in this job.
"""
import hashlib, json, os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import compare, onchain, registry, srccheck, wasminfo  # noqa: E402,F401
from expect import expected  # noqa: E402

MAX_WASM = 16 * 1024 * 1024
MAX_JSON = 1024 * 1024


def load_small_json(p):
    if not os.path.isfile(p) or os.path.islink(p) or os.path.getsize(p) > MAX_JSON:
        return {}
    try:
        v = json.load(open(p))
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def git(*a, cwd=None):
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    return subprocess.run(["git", *a], cwd=cwd, capture_output=True, text=True, env=env, timeout=900)


def one(t, artifacts, opt_bin, out_dir, work):
    hx = str(t.get("template", "")).removeprefix("template_").lower()
    if not re.fullmatch(r"[0-9a-f]{64}", hx):
        raise ValueError(f"bad template id {hx[:80]!r}")
    rid = str(t.get("id", ""))
    if not re.fullmatch(r"[0-9a-f]{12}(-[0-9]+)?", rid):
        raise ValueError(f"bad matrix id {rid!r}")
    w = os.path.join(work, rid)
    os.makedirs(w, exist_ok=True)

    # 1) on-chain bytes, fetched here
    hx2, name, author, binary = onchain.fetch(hx)
    assert hx2 == hx
    oc = {"template": hx, "name": name, "author_public_key": author,
          "onchain_sha256": hashlib.sha256(binary).hexdigest(), "onchain": wasminfo.summary(binary)}
    ocp = os.path.join(w, "onchain.json")
    json.dump(oc, open(ocp, "w"), indent=2)
    print(f"[{rid}] on-chain {name} sha256 {oc['onchain_sha256']} ({len(binary)} bytes, fetched in the record job)")

    # 2) fresh checkout + source checks
    src = os.path.join(w, "src")
    extra, err = [], None
    r = git("clone", "--quiet", t["repo"], src)
    commit_full = None
    if r.returncode != 0:
        err = "git clone failed in the record job"
    else:
        r = git("checkout", "--quiet", t["commit"], cwd=src)
        if r.returncode != 0:
            err = f"commit {t['commit']} not found"
        commit_full = git("rev-parse", "HEAD", cwd=src).stdout.strip() or None
    wd = os.path.join(src, t.get("workdir") or "")
    scp = os.path.join(w, "source_check.json")
    sc = {}
    if not err:
        os.environ["SRCCHECK_ONLINE"] = "1"  # the record job may download crate metadata; it runs no repo code
        srccheck.main(src, wd, ocp, scp)
        sc = json.load(open(scp))
    exp = {"error": err or "source checks failed"}
    if not err and not sc.get("fail"):
        exp = expected(src, wd)
    print(f"[{rid}] expected output: {exp}")

    # 3) the candidate: one fixed file from the artifact
    art = os.path.join(artifacts, f"build-{rid}")
    build = load_small_json(os.path.join(art, "build.json"))
    cand = os.path.join(art, "candidate.wasm")
    if not os.path.isfile(cand) or os.path.islink(cand):
        cand = None
    elif os.path.getsize(cand) > MAX_WASM:
        extra.append(f"candidate larger than {MAX_WASM} bytes was ignored")
        cand = None
    brel = str((build.get("expected") or {}).get("rel") or "")
    if exp.get("rel") and brel and brel.lower() != exp["rel"].lower():
        extra.append(f"build reported expected output {brel[:120]}, record job computed {exp['rel']}")
    if exp.get("error") and not sc.get("fail"):
        extra.append("expected output path: " + exp["error"])
        cand = None  # without a trusted expected path there is no candidate
    if build.get("tari_cli_sha256_after") and build.get("tari_cli_sha256_after") != build.get("tari_cli_sha256_before"):
        extra.append("tari-ootle-cli binary changed during the build")

    # 4) isolation: by construction on Linux (docker --network none); the build's probe can only downgrade
    rep = build.get("isolation") or {}
    linux = str(t.get("os", "ubuntu-latest")).startswith("ubuntu")
    iso = {"network_isolated": bool(linux and rep.get("network_isolated") is True),
           "method": ("docker --network none, non-root, no new privileges, read-only toolchain, cargo home and tools"
                      if linux else None),
           "note": rep.get("note") if rep else "no build report",
           "reported_by_build": rep}
    if not linux:
        iso["note"] = f"{t.get('os')} runner: build ran with cargo offline but without network isolation"

    recipe = {k: t.get(k, "") for k in ["template", "repo", "commit", "rustc", "builder", "tari_cli", "script",
                                         "workdir", "remap", "rustflags", "optimizer", "cmd", "os"]}
    recipe["commit_full"] = commit_full
    res = compare.run(oc, cand, build, recipe, sc, opt_bin, iso, extra)
    if err:
        res["diagnostics"] = {"error": err}
    res["expected_output"] = exp.get("rel")
    res["candidate_source"] = f"artifact build-{rid}/candidate.wasm" if cand else None
    res["onchain_source"] = "indexer, fetched by the record job"
    key = registry.key(res["repo"], res["commit"])
    res["attempt_key"] = key
    d = os.path.join(out_dir, "attempts", hx)
    os.makedirs(d, exist_ok=True)
    json.dump(res, open(os.path.join(d, key + ".json"), "w"), indent=2)
    print(json.dumps({k: res[k] for k in ("name", "onchain_sha256", "built_sha256", "match", "mode", "clean", "warnings")}, indent=1))
    shutil.rmtree(src, ignore_errors=True)
    return res


def main(matrix_path, artifacts, opt_bin, out_dir):
    m = json.load(open(matrix_path))
    work = tempfile.mkdtemp(prefix="onescan-record-")
    bad = 0
    for t in m["include"]:
        try:
            one(t, artifacts, opt_bin, out_dir, work)
        except Exception as e:
            bad += 1
            print(f"::error::record failed for {t.get('template')}: {e}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:5]))
