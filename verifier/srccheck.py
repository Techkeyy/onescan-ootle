"""Static checks on the source tree before a build, and removal of committed copies of the target binary.

Usage: python -I verifier/srccheck.py <src_dir> <workdir> <onchain.json|-> <out.json>

Records (all relative to the repo root):
  build_rs        build scripts in the template crate and its path dependencies (cargo metadata, offline),
                  or every committed build.rs when cargo metadata is unavailable
  includes        include_bytes!/include_str! that reference .wasm, a large file or a non-literal path
  blobs           committed *.wasm files and committed binary or very large files (> 50 KB)
  patch_or_git    [patch] sections in Cargo.toml files and git dependencies (Cargo.toml or Cargo.lock)
  committed       sha256 of every committed file (to detect a build that only copies one)
  scrubbed        committed files deleted before the build: every *.wasm and any file whose sha256 equals
                  the on-chain binary, so a build cannot copy or include_bytes! them
"""
import hashlib, json, os, re, subprocess, sys

BIG = 50 * 1024
NUL = bytes(1)
WASM_MAGIC = b"\x00asm"
# Media is not flagged when its content really is that format (a renamed wasm still is).
MEDIA = {".png": [b"\x89PNG"], ".gif": [b"GIF8"], ".jpg": [b"\xff\xd8"], ".jpeg": [b"\xff\xd8"],
         ".webp": [b"RIFF"], ".woff2": [b"wOF2"], ".woff": [b"wOFF"], ".pdf": [b"%PDF"], ".ico": [b"\x00\x00\x01"],
         ".ttf": [b"\x00\x01\x00\x00", b"true"], ".otf": [b"OTTO"], ".mp4": [], ".mov": [], ".webm": [b"\x1aE\xdf\xa3"]}


def media_ok(ext, data):
    if ext not in MEDIA:
        return False
    if ext in (".mp4", ".mov"):
        return data[4:8] == b"ftyp"
    return any(data.startswith(m) for m in MEDIA[ext])


TEXT_OK = {".rs", ".toml", ".lock", ".md", ".json", ".txt", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".py", ".sh", ".css", ".html", ".svg", ".yml", ".yaml"}


def git_files(src):
    out = subprocess.run(["git", "-C", src, "ls-files", "-z"], capture_output=True).stdout
    return [p for p in out.decode(errors="replace").split("\0") if p]


def is_binary(path):
    try:
        with open(path, "rb") as f:
            return b"\0" in f.read(8192)
    except OSError:
        return False


def metadata_build_rs(src, wd, files):
    """Build scripts of local packages, from cargo metadata run in the workdir and in every lockfile dir."""
    dirs = [wd] + [os.path.join(src, os.path.dirname(f)) for f in files if os.path.basename(f) == "Cargo.lock"]
    pkgs, ok = {}, False
    for d in dict.fromkeys(os.path.normpath(x) for x in dirs):
        if not os.path.isfile(os.path.join(d, "Cargo.toml")):
            continue
        try:
            env = {k: v for k, v in os.environ.items() if k != "RUSTFLAGS"}
            r = subprocess.run(["cargo", "metadata", "--offline", "--format-version", "1"], cwd=d, env=env,
                               capture_output=True, text=True, timeout=300)
            if r.returncode == 0:
                ok = True
                for p in json.loads(r.stdout).get("packages", []):
                    pkgs[p["id"]] = p
        except Exception:
            pass
    if not ok:
        return None, []
    root = os.path.realpath(src)
    found, git = [], []
    for p in pkgs.values():
        srcid = p.get("source") or ""
        if srcid.startswith("git+"):
            git.append(f"{p['name']} from {srcid.split('#')[0]}")
        if p.get("source") is None:
            for t in p.get("targets", []):
                if "custom-build" in t.get("kind", []):
                    rel = os.path.relpath(os.path.realpath(t["src_path"]), root).replace("\\", "/")
                    found.append(f"{rel} (package {p['name']})")
    return sorted(set(found)), sorted(set(git))


INC = re.compile(r"include_(bytes|str)!\s*\(\s*([^)]*)\)")


def main(src, wd, onchain_json, out_path):
    onchain = None
    if onchain_json != "-" and os.path.exists(onchain_json):
        onchain = json.load(open(onchain_json)).get("onchain_sha256")
    files = git_files(src)
    committed, blobs, includes, patch_git, scrubbed, all_build_rs = {}, [], [], [], [], []
    for rel in files:
        p = os.path.join(src, rel)
        if not os.path.isfile(p):
            continue
        data = open(p, "rb").read()
        h = hashlib.sha256(data).hexdigest()
        committed[rel] = h
        ext = os.path.splitext(rel)[1].lower()
        if ext == ".wasm" or data[:4] == WASM_MAGIC:
            blobs.append(f"{rel} ({len(data)} bytes, wasm)")
        elif len(data) > BIG and not media_ok(ext, data):
            if NUL in data[:8192] or ext not in TEXT_OK:
                blobs.append(f"{rel} ({len(data)} bytes, binary)")
            elif re.search(rb"[A-Za-z0-9+/=]{2000}|[0-9a-fA-F]{2000}", data):
                blobs.append(f"{rel} ({len(data)} bytes, contains a long base64/hex run)")
        if os.path.basename(rel) == "build.rs":
            all_build_rs.append(rel)
        if ext == ".rs":
            text = data.decode(errors="replace")
            for kind, arg in INC.findall(text):
                arg = arg.strip()
                lit = re.fullmatch(r'"([^"]*)"', arg)
                if not lit:
                    includes.append(f"{rel}: include_{kind}!({arg[:80]}) uses a computed path")
                    continue
                target = os.path.normpath(os.path.join(os.path.dirname(p), lit.group(1)))
                size = os.path.getsize(target) if os.path.isfile(target) else None
                if lit.group(1).lower().endswith(".wasm") or (size or 0) > BIG:
                    includes.append(f"{rel}: include_{kind}!(\"{lit.group(1)}\")" + (f" ({size} bytes)" if size else ""))
        if os.path.basename(rel) == "Cargo.toml":
            text = data.decode(errors="replace")
            if re.search(r"^\s*\[patch[.\]]", text, re.M):
                patch_git.append(f"{rel}: [patch] section")
            if re.search(r"\bgit\s*=\s*\"", text):
                patch_git.append(f"{rel}: git dependency")
        if os.path.basename(rel) == "Cargo.lock" and 'source = "git+' in data.decode(errors="replace"):
            patch_git.append(f"{rel}: git source in lockfile")
        if ext == ".wasm" or (onchain and h == onchain):
            scrubbed.append(rel + (" (equals the on-chain binary)" if onchain and h == onchain else ""))
    for s in scrubbed:
        try:
            os.remove(os.path.join(src, s.split(" (")[0]))
        except OSError:
            pass
    build_rs, git_deps = metadata_build_rs(src, wd, files)
    scope = "template crate and its path dependencies (cargo metadata)"
    if build_rs is None:
        build_rs, scope = all_build_rs, "every committed build.rs (cargo metadata unavailable for this recipe)"
    patch_git += [f"dependency {g}" for g in git_deps if not any(g.split()[0] in x for x in patch_git)]
    res = {"build_rs": build_rs, "build_rs_scope": scope, "includes": includes, "blobs": blobs,
           "patch_or_git": patch_git, "scrubbed": scrubbed, "committed_count": len(committed),
           "committed": committed}
    json.dump(res, open(out_path, "w"), indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != "committed"}, indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:5])
