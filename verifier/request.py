"""Verify-request helpers for the issue flow and the web build.

  python -I verifier/request.py parse            reads env BODY (issue-form markdown), validates every
                                                 field and appends key=value lines to $GITHUB_OUTPUT
  python -I verifier/request.py report REC RUN   prints a Markdown comment for registry record REC

cause(record) is shared with web/build.py so the site and the issue comment say the same thing.
"""
import json, os, re, sys

SITE = "https://techkeyy.github.io/onescan-ootle/"

# issue-form heading -> (field, regex). Every value must match fully; empty means "not given".
FIELDS = {
    "Template address": ("template", r"(template_)?[0-9a-f]{64}"),
    "Source repository": ("repo", r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?(\.git)?/?"),
    "Commit": ("commit", r"[0-9a-f]{7,40}"),
    "Crate sub-directory": ("workdir", r"[A-Za-z0-9_][A-Za-z0-9_./-]{0,99}"),
    "Rust toolchain": ("rustc", r"[0-9A-Za-z][0-9A-Za-z._-]{0,59}"),
    "Builder": ("builder", r"auto|cargo|tari-cli"),
    "tari-ootle-cli version": ("tari_cli", r"[0-9]+\.[0-9]+\.[0-9]+"),
    "CARGO_HOME remap": ("remap", r"none|[A-Za-z0-9_./:~ -]{1,100}"),
    "walletd optimizer": ("optimizer", r"auto|on|off"),
    "Runner OS": ("os", r"ubuntu-latest|windows-latest"),
}
REQUIRED = {"template", "repo", "commit"}


def parse(body):
    parts = re.split(r"^###\s+", body or "", flags=re.M)
    got, errors = {}, []
    for p in parts[1:]:
        head, _, val = p.partition("\n")
        head, val = head.strip(), val.strip()
        if head not in FIELDS:
            continue
        key, rx = FIELDS[head]
        if val in ("", "_No response_", "None"):
            val = ""
        val = val.splitlines()[0].strip() if val else ""
        if key == "commit":
            val = val.lower()
        if key == "template":
            val = val.lower().removeprefix("template_")
        if val and (not re.fullmatch(rx, val) or ".." in val):
            errors.append(f"{head}: `{val[:80]}` is not valid")
            continue
        if key == "builder" and val == "auto":
            val = ""
        if key == "repo":
            val = re.sub(r"(\.git)?/?$", "", val)
        got[key] = val
    for k in REQUIRED:
        if not got.get(k):
            name = next(h for h, (f, _) in FIELDS.items() if f == k)
            if not any(e.startswith(name) for e in errors):
                errors.append(f"{name} is required")
    return got, errors


def cause(r):
    """One-line reason for a record (same wording as verifier/summary.py)."""
    d = r.get("diagnostics") or {}
    if r.get("match"):
        return "byte-identical"
    if d.get("error"):
        return d["error"]
    bits = []
    if d.get("tari_tdef_equal") is False:
        bits.append("tari_tdef differs (source/ABI at this commit is not what was published)")
    if d.get("rustc_commit_equal") is False:
        bits.append(f"rustc differs (on-chain {str(d.get('onchain_rustc_commit'))[:9]}, built {str(d.get('built_rustc_commit'))[:9]})")
    if d.get("onchain_paths") != d.get("built_paths"):
        bits.append("leaked paths differ")
    if not bits:
        bits.append("same ABI, toolchain and paths; code bytes differ (optimizer/profile/dependency drift)")
    return "; ".join(bits) + f" (sizes on-chain {d.get('onchain_size')} vs built {d.get('closest_size')})"


def report(rec, run_url):
    r = json.load(open(rec))
    hx = r["template"]
    if r["match"]:
        head = "**VERIFIED**: the on-chain bytes build from this commit." if r.get("clean") else \
            "**VERIFIED, WITH WARNINGS**: the on-chain bytes build from this commit; read the warnings below."
    elif r.get("mode") == "rejected":
        head = "**REJECTED**: the source tree failed a hard check, so the build output is not trusted."
    else:
        head = "**NOT REPRODUCED**: the build did not give the on-chain bytes."
    lines = [head, "",
             f"- Template: `template_{hx}` ({r.get('name')})",
             f"- Source: {r.get('repo')} @ `{r.get('commit')}`",
             f"- On-chain sha256: `{r.get('onchain_sha256')}`",
             f"- Built sha256: `{r.get('built_sha256')}`" + (f" (mode: {r.get('mode')})" if r["match"] else ""),
             f"- Run: {r.get('run_url') or run_url}"]
    if not r["match"]:
        lines.append(f"- Cause: {cause(r)}")
    for w in (r.get("warnings") or [])[:12]:
        lines.append(f"- Warning: {w}")
    lines +=["", f"Result page (updates after the site redeploys): {SITE}?t={hx}", "",
              "Verified source is not an audit: a match proves which commit these bytes come from, not that the code is safe."]
    return "\n".join(lines)


if __name__ == "__main__":
    if sys.argv[1] == "parse":
        got, errors = parse(os.environ.get("BODY", ""))
        out = [f"{k}={v}" for k, v in got.items()]
        out.append("error=" + " | ".join(errors))
        print("\n".join(out))
        if os.environ.get("GITHUB_OUTPUT"):
            open(os.environ["GITHUB_OUTPUT"], "a").write("\n".join(out) + "\n")
    elif sys.argv[1] == "report":
        print(report(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else ""))
