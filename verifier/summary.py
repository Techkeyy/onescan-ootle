"""Regenerate registry/SUMMARY.md from the summary records registry/*.json.

Usage: python -I verifier/summary.py [registry_dir]
OWN is the same set web/build.py uses (the project author's own templates are not counted as third-party).
"""
import glob, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from request import cause  # noqa: E402  (same wording as the site and the issue comment)

OWN = {"6494a4fe7ea2de9276aada3b77086dfc14242fe4b96629a694745b24e49fb2d2",  # Ootle Split, the project author's own
       "5b0efecc709ce6885b69738ce8f774f086ef0c6cb7b2a58920f8bab3e38f8b13"}  # OneScan SourceRegistry (self-verified)


def write(reg):
    rows = []
    for p in sorted(glob.glob(os.path.join(reg, "*.json"))):
        r = json.load(open(p))
        if "template" not in r:
            continue
        rows.append((r["template"] in OWN, r))
    third = [r for own, r in rows if not own]
    hit = sum(1 for r in third if r["match"])
    clean = sum(1 for r in third if r.get("clean"))
    own_names = [r["name"] for own, r in rows if own]
    out = ["# OneScan verification summary", "",
           f"Third-party templates reproduced: **{hit} / {len(third)}** ({clean} clean, {hit - clean} with warnings)"
           + (f" (plus our own: {', '.join(own_names)})" if own_names else ""), "",
           "A match means the sha256 of a fresh build from the named commit equals the template binary in the "
           "on-chain substate. It is not an audit. Each row shows the best attempt for the template; every attempt "
           "is kept under `registry/attempts/<template>/`.", "",
           "| Template | Name | Repo @ commit | Mode | On-chain sha256 | Built sha256 | Result | Warnings | Attempts | Run |",
           "|---|---|---|---|---|---|---|---|---|---|"]
    for own, r in rows:
        repo = (r.get("repo") or "").removeprefix("https://github.com/")
        res = ("MATCH" + ("" if r.get("clean") else " (warnings)")) if r["match"] else \
            ("REJECTED: " if r.get("mode") == "rejected" else "miss: ") + cause(r)
        out.append(f"| `{r['template'][:12]}…` | {r['name']}{' (own)' if own else ''} | {repo} @ `{(r.get('commit') or '')[:10]}` "
                   f"| {r['mode']} | `{r['onchain_sha256'][:12]}…` | `{(r.get('built_sha256') or '-')[:12]}…` "
                   f"| {res} | {len(r.get('warnings') or [])} | {len(r.get('attempts') or [1])} | [run]({r.get('run_url')}) |")
    out += ["", "## Notes on misses", "",
            "- Signal Desk (desk, forecasts, follows) and Cursed Pumpkin: the ABI section, rustc commit and leaked "
            "paths all match, and both `cargo build` and `tari build` (tari-ootle-cli 0.35.x) give the same bytes, "
            "so the walletd optimizer input differs in code only. walletd v0.53-v0.55 use the same wasm-opt 0.116.1 "
            "and the same options, so the likely cause is a different commit or Cargo.lock at publish time. Not iterated further.",
            "- MoonMail: the `tari_tdef` section built from `contracts/moonmail-v4` at the public HEAD differs from the "
            "published one, so the published source is not at that commit (or not in that directory).",
            "- Recipes are inferred from the binary: rustc from the `/rustc/<commit>` string, the cargo-home remap from "
            "leaked registry paths (for example `/home/<user>/.cargo` or `C:/Users/<user>/.cargo` style Windows paths, rebuilt on a Windows runner), "
            "and the walletd optimizer from the DataCount section."]
    open(os.path.join(reg, "SUMMARY.md"), "w").write("\n".join(out) + "\n")
    print("\n".join(out[:3]))


if __name__ == "__main__":
    write(sys.argv[1] if len(sys.argv) > 1 else "registry")
