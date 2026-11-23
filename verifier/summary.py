"""Regenerate registry/SUMMARY.md from registry/*.json. Usage: python -I verifier/summary.py [registry_dir]"""
import glob, json, os, sys

reg = sys.argv[1] if len(sys.argv) > 1 else "registry"
OWN = {"6494a4fe7ea2de9276aada3b77086dfc14242fe4b96629a694745b24e49fb2d2"}  # Ootle Split: our own template
rows = []
for p in sorted(glob.glob(os.path.join(reg, "*.json"))):
    r = json.load(open(p))
    if "template" not in r:
        continue
    d = r.get("diagnostics") or {}
    if r["match"]:
        why = "byte-identical"
    elif d.get("error"):
        why = d["error"]
    else:
        bits = []
        if d.get("tari_tdef_equal") is False:
            bits.append("tari_tdef differs (source/ABI at this commit is not what was published)")
        if d.get("rustc_commit_equal") is False:
            bits.append(f"rustc differs (on-chain {str(d.get('onchain_rustc_commit'))[:9]}, built {str(d.get('built_rustc_commit'))[:9]})")
        if d.get("onchain_paths") != d.get("built_paths"):
            bits.append("leaked paths differ")
        if not bits:
            bits.append("same ABI, toolchain and paths; code bytes differ (optimizer/profile/dependency drift)")
        why = "; ".join(bits) + f" (sizes on-chain {d.get('onchain_size')} vs built {d.get('closest_size')})"
    rows.append((r["template"] in OWN, r, why))

third = [x for x in rows if not x[0]]
hit = sum(1 for _, r, _ in third if r["match"])
out = ["# OneScan verification summary", "",
       f"Third-party templates reproduced: **{hit} / {len(third)}**"
       + (" (plus Ootle Split, our own)" if any(o for o, _, _ in rows) else ""), "",
       "A match means the sha256 of a fresh build from the named commit equals the template binary in the "
       "on-chain substate. It is not an audit.", "",
       "| Template | Name | Repo @ commit | Mode | On-chain sha256 | Built sha256 | Result | Run |",
       "|---|---|---|---|---|---|---|---|"]
for own, r, why in rows:
    repo = (r.get("repo") or "").removeprefix("https://github.com/")
    out.append(f"| `{r['template'][:12]}…` | {r['name']}{' (own)' if own else ''} | {repo} @ `{(r.get('commit') or '')[:10]}` "
               f"| {r['mode']} | `{r['onchain_sha256'][:12]}…` | `{(r.get('built_sha256') or '-')[:12]}…` "
               f"| {'MATCH' if r['match'] else 'miss: ' + why} | [run]({r.get('run_url')}) |")
open(os.path.join(reg, "SUMMARY.md"), "w").write("\n".join(out) + "\n")
print("\n".join(out[:3]))
