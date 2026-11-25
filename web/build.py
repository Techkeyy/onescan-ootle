"""Build the static site: copy web/ to OUT and add data/registry.json and badge/<hex>.json from registry/.

Usage: python -I web/build.py [out_dir]   (default _site). Run from the repo root.
"""
import glob, json, os, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "verifier"))
from request import cause  # noqa: E402

OWN = {"6494a4fe7ea2de9276aada3b77086dfc14242fe4b96629a694745b24e49fb2d2",  # Ootle Split, the project author's own
       "5b0efecc709ce6885b69738ce8f774f086ef0c6cb7b2a58920f8bab3e38f8b13"}  # OneScan SourceRegistry (self-verified)
KEEP = ["template", "name", "author_public_key", "onchain_sha256", "built_sha256", "match", "mode", "repo",
        "commit", "toolchain", "recipe", "run_url", "runner_os", "verified_at", "isolation", "warnings"]

out = sys.argv[1] if len(sys.argv) > 1 else "_site"
web = os.path.join(ROOT, "web")
if os.path.exists(out):
    shutil.rmtree(out)
shutil.copytree(web, out, ignore=shutil.ignore_patterns("build.py", "__pycache__"))
os.makedirs(os.path.join(out, "data"), exist_ok=True)
os.makedirs(os.path.join(out, "badge"), exist_ok=True)

records = {}
for p in sorted(glob.glob(os.path.join(ROOT, "registry", "*.json"))):
    r = json.load(open(p))
    if "template" not in r:
        continue
    rec = {k: r.get(k) for k in KEEP}
    rec["cause"] = cause(r)
    rec["own"] = r["template"] in OWN
    if "clean" not in r:  # recorded before network isolation and source checks existed
        rec["warnings"] = ["recorded before the hardened verifier (no network isolation or source checks)"]
    rec["clean"] = bool(r["match"] and not rec["warnings"])
    d = r.get("diagnostics") or {}
    rec["sizes"] = [d.get("onchain_size"), d.get("closest_size")] if d else None
    records[r["template"]] = rec
    badge = {"schemaVersion": 1, "label": "OneScan",
             "message": "source verified" if rec["clean"] else "verified, with warnings" if r["match"] else "source not reproduced",
             "color": "15803d" if rec["clean"] else "b45309" if r["match"] else "6b7280", "cacheSeconds": 3600}
    json.dump(badge, open(os.path.join(out, "badge", r["template"] + ".json"), "w"))

third = [r for r in records.values() if not r["own"]]
data = {"generated": max((r["verified_at"] or "" for r in records.values()), default=""),
        "reproduced": sum(1 for r in third if r["match"]), "clean": sum(1 for r in third if r["clean"]),
        "attempted": len(third),
        "records": records}
json.dump(data, open(os.path.join(out, "data", "registry.json"), "w"), separators=(",", ":"))
print(f"built {out}: {len(records)} records, {data['reproduced']}/{data['attempted']} third-party reproduced")
