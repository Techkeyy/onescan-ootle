"""Compare freshly built WASM candidates with the on-chain bytes and write the result JSON.

Usage: python -I verifier/compare.py <onchain_dir> <build_dir> <walletd_opt_bin|-> <out.json>
<build_dir> holds build.json (recipe + toolchain) and candidates/*.wasm (fresh build outputs only).
"""
import glob, hashlib, json, os, subprocess, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wasminfo  # noqa: E402


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def main(onchain_dir, build_dir, opt_bin, out_path):
    oc = json.load(open(os.path.join(onchain_dir, "onchain.json")))
    bj_path = os.path.join(build_dir, "build.json")
    build = json.load(open(bj_path)) if os.path.exists(bj_path) else {}
    recipe = build.get("recipe", {})
    mode_req = recipe.get("optimizer", "auto")
    target = oc["onchain_sha256"]
    cands = sorted(glob.glob(os.path.join(build_dir, "candidates", "*.wasm")))
    tried, match, mode, built_sha = [], False, None, None

    if mode_req in ("auto", "off"):
        for c in cands:
            h = sha(c); tried.append({"file": os.path.basename(c), "variant": "raw", "sha256": h})
            if h == target:
                match, mode, built_sha = True, "raw", h; break
    if not match and mode_req in ("auto", "on") and opt_bin != "-" and os.path.exists(opt_bin):
        for c in cands:
            out = os.path.join(tempfile.mkdtemp(), "opt.wasm")
            r = subprocess.run([opt_bin, c, out], capture_output=True, text=True)
            if r.returncode != 0:
                tried.append({"file": os.path.basename(c), "variant": "walletd-optimized",
                              "error": r.stderr[-300:]}); continue
            h = sha(out); tried.append({"file": os.path.basename(c), "variant": "walletd-optimized", "sha256": h})
            if h == target:
                match, mode, built_sha = True, "walletd-optimized", h; break
            os.replace(out, c + ".opt")

    # Diagnostics for a miss: compare against the candidate whose tari_tdef matches, if any.
    diag = None
    if not match:
        ocs = oc["onchain"]
        best = None
        for c in cands:
            for p in (c, c + ".opt"):
                if os.path.exists(p):
                    s = wasminfo.summary(open(p, "rb").read())
                    if best is None or (s["tari_tdef_sha256"] == ocs["tari_tdef_sha256"] and abs(s["size"] - ocs["size"]) < abs(best[1]["size"] - ocs["size"])):
                        best = (os.path.basename(p), s)
        if best:
            s = best[1]
            diag = {"closest": best[0], "closest_sha256": s["sha256"], "closest_size": s["size"],
                    "onchain_size": ocs["size"],
                    "tari_tdef_equal": s["tari_tdef_sha256"] == ocs["tari_tdef_sha256"],
                    "rustc_commit_equal": s["rustc_commit"] == ocs["rustc_commit"],
                    "onchain_rustc_commit": ocs["rustc_commit"], "built_rustc_commit": s["rustc_commit"],
                    "onchain_paths": ocs["path_hints"], "built_paths": s["path_hints"],
                    "onchain_sections": ocs["sections"], "built_sections": s["sections"]}
            if built_sha is None:
                built_sha = s["sha256"]
        else:
            diag = {"error": build.get("error") or "build produced no wasm"}

    res = {
        "template": oc["template"], "name": oc["name"], "author_public_key": oc["author_public_key"],
        "onchain_sha256": target, "built_sha256": built_sha, "match": match,
        "mode": mode or "no-match", "repo": recipe.get("repo"), "commit": build.get("commit_full") or recipe.get("commit"),
        "toolchain": build.get("toolchain"), "recipe": recipe, "run_url": build.get("run_url") or os.environ.get("RUN_URL"),
        "runner_os": build.get("runner_os"), "verified_at": os.environ.get("VERIFIED_AT"),
        "tried": tried, "diagnostics": diag,
        "note": "Verified source is not an audit. A match proves these bytes build from this commit.",
    }
    json.dump(res, open(out_path, "w"), indent=2)
    print(json.dumps({k: res[k] for k in ("name", "onchain_sha256", "built_sha256", "match", "mode")}))


if __name__ == "__main__":
    main(*sys.argv[1:5])
