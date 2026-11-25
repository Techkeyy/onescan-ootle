"""Compare one candidate WASM with the on-chain bytes and build the result record.

Library: run(onchain, candidate, build, recipe, sc, opt_bin, isolation, extra_warnings) -> record dict
  onchain     onchain.json content (fetched by the TRUSTED record job, never taken from a build artifact)
  candidate   path of the single candidate wasm (the target crate's release output), or None
  build       build.json from the artifact: informational only (toolchain strings, build error)
  recipe      the recipe from the plan matrix (trusted)
  sc          source_check.json content (srccheck run by the record job on a fresh checkout)
  isolation   isolation verdict decided by the record job
CLI (selftest / manual): python -I verifier/compare.py --onchain J --candidate W --build J --source-check J
                         --recipe J [--opt BIN] [--isolation J] --out OUT.json
"""
import argparse, hashlib, json, os, subprocess, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wasminfo  # noqa: E402

PIPELINE = 2  # 1 = before the record job stopped trusting artifact metadata


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def warnings_for(sc, iso, extra):
    w = []
    if not iso.get("network_isolated"):
        w.append("network not isolated during the build: " + str(iso.get("note")))
    if not sc:
        w.append("source checks did not run")
    for p in sc.get("build_rs", []):
        w.append("build script: " + p)
    for p in sc.get("proc_macros", []):
        w.append("proc-macro crate in the repo: " + p)
    for p in sc.get("includes", []):
        w.append("embedded file: " + p)
    for p in sc.get("blobs", []):
        w.append("committed binary or large file: " + p)
    for p in sc.get("numeric", []):
        w.append("numeric data: " + p)
    for p in sc.get("patch_or_git", []):
        w.append("dependency override: " + p)
    for p in sc.get("config", []):
        w.append("cargo config: " + p)
    for p in sc.get("scrubbed", []):
        if "equals the on-chain binary" in p:
            w.append("a copy of the on-chain binary is committed at " + p.split(" (")[0] + "; it was deleted before the build")
    return w + list(extra or [])


def run(oc, candidate, build, recipe, sc, opt_bin, iso, extra_warnings=None):
    mode_req = recipe.get("optimizer") or "auto"
    target = oc["onchain_sha256"]
    sc = dict(sc or {})
    committed = sc.pop("committed", {}) or {}
    fails = sc.get("fail") or []
    tried, match, mode, built_sha, diag = [], False, None, None, None
    variants = []
    if candidate and os.path.isfile(candidate) and not fails:
        variants.append(("raw", candidate))
        if mode_req in ("auto", "off"):
            h = sha(candidate)
            tried.append({"file": os.path.basename(candidate), "variant": "raw", "sha256": h})
            if h == target:
                match, mode, built_sha = True, "raw", h
        if not match and mode_req in ("auto", "on") and opt_bin and opt_bin != "-" and os.path.exists(opt_bin):
            out = os.path.join(tempfile.mkdtemp(), "opt.wasm")
            r = subprocess.run([opt_bin, candidate, out], capture_output=True, text=True, timeout=600)
            if r.returncode != 0:
                tried.append({"file": os.path.basename(candidate), "variant": "walletd-optimized", "error": r.stderr[-300:]})
            else:
                h = sha(out)
                tried.append({"file": os.path.basename(candidate), "variant": "walletd-optimized", "sha256": h})
                variants.append(("walletd-optimized", out))
                if h == target:
                    match, mode, built_sha = True, "walletd-optimized", h

    if fails:
        diag = {"error": "rejected by source checks: " + "; ".join(fails)}
    elif not match:
        ocs = oc["onchain"]
        best = None
        for name, p in variants:
            s = wasminfo.summary(open(p, "rb").read())
            if best is None or (s["tari_tdef_sha256"] == ocs["tari_tdef_sha256"]
                                and abs(s["size"] - ocs["size"]) < abs(best[1]["size"] - ocs["size"])):
                best = (name, s)
        if best:
            s = best[1]
            diag = {"closest": best[0], "closest_sha256": s["sha256"], "closest_size": s["size"],
                    "onchain_size": ocs["size"],
                    "tari_tdef_equal": s["tari_tdef_sha256"] == ocs["tari_tdef_sha256"],
                    "rustc_commit_equal": s["rustc_commit"] == ocs["rustc_commit"],
                    "onchain_rustc_commit": ocs["rustc_commit"], "built_rustc_commit": s["rustc_commit"],
                    "onchain_paths": ocs["path_hints"], "built_paths": s["path_hints"],
                    "onchain_sections": ocs["sections"], "built_sections": s["sections"]}
            built_sha = s["sha256"]
        else:
            diag = {"error": (build or {}).get("error") or "build produced no wasm at the expected path"}

    warnings = warnings_for(sc, iso, extra_warnings)
    copied = [f for f, h in committed.items() if built_sha and h == built_sha
              and not any(s.startswith(f) for s in sc.get("scrubbed", []))]
    if match and copied:
        match, mode = False, "no-match"
        diag = {"error": "binary is committed in source: the matching output equals " + ", ".join(copied)}

    build = build or {}
    res = {
        "template": oc["template"], "name": oc["name"], "author_public_key": oc["author_public_key"],
        "onchain_sha256": target, "built_sha256": built_sha, "match": match,
        "mode": "rejected" if fails else (mode or "no-match"),
        "repo": recipe.get("repo"), "commit": recipe.get("commit_full") or recipe.get("commit"),
        "toolchain": build.get("toolchain"), "recipe": {k: v for k, v in recipe.items() if k not in ("commit_full", "id")},
        "run_url": os.environ.get("RUN_URL") or build.get("run_url"), "runner_os": build.get("runner_os"),
        "verified_at": os.environ.get("VERIFIED_AT"),
        "tried": tried, "diagnostics": diag, "isolation": iso, "source_check": sc,
        "warnings": warnings, "clean": bool(match and not warnings), "pipeline": PIPELINE,
        "note": "Verified source is not an audit. A match proves these bytes build from this commit.",
    }
    return res


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--onchain", required=True)
    a.add_argument("--candidate")
    a.add_argument("--build")
    a.add_argument("--source-check")
    a.add_argument("--recipe", required=True)
    a.add_argument("--opt", default="-")
    a.add_argument("--isolation")
    a.add_argument("--out", required=True)
    o = a.parse_args()
    ld = lambda p: json.load(open(p)) if p and os.path.exists(p) else {}  # noqa: E731
    build = ld(o.build)
    iso = ld(o.isolation) or build.get("isolation") or {"network_isolated": False, "note": "unknown"}
    res = run(ld(o.onchain), o.candidate, build, ld(o.recipe), ld(o.source_check), o.opt, iso)
    json.dump(res, open(o.out, "w"), indent=2)
    print(json.dumps({k: res[k] for k in ("name", "onchain_sha256", "built_sha256", "match", "mode", "clean")}))


if __name__ == "__main__":
    main()
