"""Static checks on a source tree, and removal of committed copies of the target binary.

Usage:
  python -I verifier/srccheck.py <src_dir> <workdir> <onchain.json|-> <out.json>
  python -I verifier/srccheck.py --config-only <src_dir>      exit 2 when a hard failure is found

Nothing here builds or runs repo code. cargo metadata (which runs no build scripts) is only called when the
hard checks pass, so a repo cannot reach cargo with a hostile .cargo/config.

Hard failures (`fail`, the verdict becomes "rejected"):
  - a committed .cargo/config or .cargo/config.toml at any level that sets a linker, runner, rustc,
    rustc-wrapper, rustdoc, [source] replacement (vendored dirs), [registries]/[registry], credential
    providers, includes, [unstable], legacy `paths`, build-script overrides, or rustflags carrying
    link-arg/linker/-L/-l/-Z/codegen-backend
  - a rust-toolchain(.toml) that names a custom toolchain path or a channel that is not a rustup channel
  - committed symlinks that point outside the repo or into/as a .cargo config
Warnings (all relative to the repo root):
  build_rs        build scripts in the template crate and its path dependencies (cargo metadata)
  proc_macros     proc-macro crates committed in the repo (they run at compile time, like build scripts)
  includes        include_bytes!/include_str! that reference .wasm, a large file or a computed path
  blobs           committed *.wasm, binary or very large files, long hex/base64 runs, split-up small binaries
  numeric         long numeric array literals / data files, and many of them (split-up blobs)
  patch_or_git    [patch] sections and git dependencies (Cargo.toml, Cargo.lock, cargo config)
  config          other keys in a committed cargo config (env, net, http, target-dir, ...)
  committed       sha256 of every committed file (to detect a build that only copies one)
  scrubbed        committed files deleted before the build: every *.wasm and any file equal to the on-chain binary
"""
import hashlib, json, os, re, subprocess, sys
try:
    import tomllib
except ImportError:  # pragma: no cover
    tomllib = None

BIG = 50 * 1024
NUL = bytes(1)
WASM_MAGIC = b"\x00asm"
MEDIA = {".png": [b"\x89PNG"], ".gif": [b"GIF8"], ".jpg": [b"\xff\xd8"], ".jpeg": [b"\xff\xd8"],
         ".webp": [b"RIFF"], ".woff2": [b"wOF2"], ".woff": [b"wOFF"], ".pdf": [b"%PDF"], ".ico": [b"\x00\x00\x01"],
         ".ttf": [b"\x00\x01\x00\x00", b"true"], ".otf": [b"OTTO"], ".mp4": [], ".mov": [], ".webm": [b"\x1aE\xdf\xa3"]}
TEXT_OK = {".rs", ".toml", ".lock", ".md", ".json", ".txt", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".py", ".sh",
           ".css", ".html", ".svg", ".yml", ".yaml"}
CONFIG_RX = re.compile(r"(^|/)\.cargo/config(\.toml)?$")
CHANNEL_RX = re.compile(r"(stable|beta|nightly|[0-9]+\.[0-9]+(\.[0-9]+)?)(-[0-9]{4}-[0-9]{2}-[0-9]{2})?(-[a-z0-9_]+){0,4}")
# A run of >= 32 small numbers (decimal <= 3 digits or 0xNN) separated by commas, semicolons or whitespace.
NUMRUN = re.compile(rb"(?:(?:0[xX][0-9a-fA-F]{1,2}|[0-9]{1,3})(?:[ \t]*[,;][ \t\r\n]*|[ \t\r\n]+)){32,}")
NUMTOK = re.compile(rb"0[xX][0-9a-fA-F]{1,2}|[0-9]{1,3}")
HEXRUN = re.compile(rb"[0-9a-fA-F]{512,}|[A-Za-z0-9+/]{1024,}={0,2}")
NUM_FILE, NUM_MANY, NUM_TOTAL = 256, 8, 4096
SELFTEST_ALLOW_CONFIG = bool(os.environ.get("ONESCAN_SELFTEST_ALLOW_CARGO_CONFIG"))  # selftest control only


def media_ok(ext, data):
    if ext not in MEDIA:
        return False
    if ext in (".mp4", ".mov"):
        return data[4:8] == b"ftyp"
    return any(data.startswith(m) for m in MEDIA[ext])


def git_entries(src):
    """(mode, path) of every committed entry; mode 120000 is a symlink."""
    out = subprocess.run(["git", "-C", src, "ls-files", "-s", "-z"], capture_output=True).stdout
    res = []
    for rec in out.decode(errors="replace").split("\0"):
        if rec:
            meta, _, path = rec.partition("\t")
            res.append((meta.split(" ")[0], path))
    return res


# ---------------------------------------------------------------- hard checks (no cargo involved)

def bad_flags(v):
    """Rustflags tokens that can change linking or hand the compiler a payload."""
    if isinstance(v, str):
        toks = v.split()
    elif isinstance(v, list):
        toks = [str(x) for x in v]
    elif v is None:
        return []
    else:
        toks = [str(v)]
    bad = []
    for t in toks:
        tl = t.lower()
        if re.search(r"link-?args?|linker|link-self-contained|codegen-backend|pre-link|llvm-args", tl) \
                or t in ("-L", "-l") or re.match(r"-[lL]\S", t) or t.startswith("-Z") or tl.startswith("--extern"):
            bad.append(t)
    return bad


def check_config(rel, text):
    fails, warns = [], []
    if tomllib is None:
        return [f"{rel}: cannot parse cargo config (no tomllib)"], warns
    try:
        d = tomllib.loads(text)
    except Exception as e:
        return [f"{rel}: unparseable cargo config ({str(e)[:80]})"], warns
    if "credential-provider" in text or "credential_provider" in text:
        fails.append(f"{rel}: credential provider")
    for k in ("include", "paths"):
        if k in d:
            fails.append(f"{rel}: `{k}`")
    for k in ("source", "registries", "registry", "unstable"):
        if k in d:
            fails.append(f"{rel}: [{k}]")
    b = d.get("build") if isinstance(d.get("build"), dict) else {}
    for k in ("rustc", "rustc-wrapper", "rustc-workspace-wrapper", "rustdoc"):
        if k in b:
            fails.append(f"{rel}: build.{k}")
    for k in ("rustflags", "rustdocflags"):
        if bad_flags(b.get(k)):
            fails.append(f"{rel}: build.{k} {bad_flags(b.get(k))}")
    if "target-dir" in b:
        warns.append(f"{rel}: build.target-dir")

    def section(name, conf):
        for k, v in conf.items():
            if k in ("linker", "runner", "ar"):
                fails.append(f"{rel}: {name}.{k}")
            elif k in ("rustflags", "rustdocflags"):
                if bad_flags(v):
                    fails.append(f"{rel}: {name}.{k} {bad_flags(v)}")
            elif isinstance(v, dict):
                fails.append(f"{rel}: {name}.{k} build-script override")
            else:
                warns.append(f"{rel}: {name}.{k}")

    for triple, conf in (d.get("target") or {}).items():
        if isinstance(conf, dict):
            section(f"target.{triple}", conf)
        else:
            fails.append(f"{rel}: target.{triple}")
    for k, v in (d.get("host") or {}).items():
        if isinstance(v, dict):
            section(f"host.{k}", v)
        else:
            section("host", {k: v})
    if "patch" in d:
        warns.append(f"{rel}: [patch] in cargo config")
    for k in ("env", "net", "http"):
        if k in d:
            warns.append(f"{rel}: [{k}]")
    known = {"build", "target", "host", "patch", "env", "net", "http", "alias", "profile", "term", "doc",
             "cargo-new", "future-incompat-report", "install", "cache", "include", "paths", "source",
             "registries", "registry", "unstable", "credential-alias"}
    warns += [f"{rel}: [{k}]" for k in d if k not in known]
    return fails, warns


def check_toolchain_file(rel, text):
    if rel.endswith(".toml") or text.lstrip().startswith("["):
        if tomllib is None:
            return [f"{rel}: cannot parse"]
        try:
            d = tomllib.loads(text)
        except Exception as e:
            return [f"{rel}: unparseable rust-toolchain ({str(e)[:60]})"]
        tc = d.get("toolchain") or {}
        if "path" in tc:
            return [f"{rel}: custom toolchain path {str(tc['path'])[:80]!r}"]
        ch = str(tc.get("channel") or "")
        if ch and not CHANNEL_RX.fullmatch(ch):
            return [f"{rel}: channel {ch[:60]!r} is not a rustup channel"]
        return []
    first = (text.strip().splitlines() or [""])[0].strip()
    if first and not CHANNEL_RX.fullmatch(first):
        return [f"{rel}: {first[:60]!r} is not a rustup channel"]
    return []


def hard_checks(src, entries):
    fails, warns = [], []
    root = os.path.realpath(src)
    for mode, rel in entries:
        p = os.path.join(src, rel)
        parts = rel.split("/")
        if mode == "120000":
            tgt = os.readlink(p) if os.path.islink(p) else ""
            if not tgt and os.path.isfile(p):  # symlinks checked out as plain files (core.symlinks=false)
                tgt = open(p, "rb").read(512).decode(errors="replace")
            dest = os.path.realpath(os.path.join(os.path.dirname(p), tgt))
            if os.path.isabs(tgt) or re.match(r"^[A-Za-z]:", tgt) or os.path.commonpath([dest, root]) != root:
                fails.append(f"{rel}: symlink pointing outside the repo ({tgt[:80]})")
            elif ".cargo" in parts or ".cargo" in tgt.replace("\\", "/").split("/") \
                    or parts[-1] in ("rust-toolchain", "rust-toolchain.toml"):
                fails.append(f"{rel}: symlink into or as a .cargo config / toolchain file ({tgt[:80]})")
            continue
        if not os.path.isfile(p):
            continue
        if CONFIG_RX.search(rel):
            f, w = check_config(rel, open(p, "rb").read().decode(errors="replace"))
            fails += f
            warns += w
        if parts[-1] in ("rust-toolchain", "rust-toolchain.toml"):
            fails += check_toolchain_file(rel, open(p, "rb").read().decode(errors="replace"))
    if SELFTEST_ALLOW_CONFIG:
        warns += [f"(selftest control: hard failure demoted) {x}" for x in fails]
        fails = []
    return fails, warns


# ---------------------------------------------------------------- cargo metadata (only after hard checks pass)

def metadata_build_rs(src, wd, files):
    """Build scripts of local packages, from cargo metadata run in the workdir and in every lockfile dir."""
    dirs = [wd] + [os.path.join(src, os.path.dirname(f)) for f in files if os.path.basename(f) == "Cargo.lock"]
    pkgs, ok = {}, False
    online = bool(os.environ.get("SRCCHECK_ONLINE"))
    for d in dict.fromkeys(os.path.normpath(x) for x in dirs):
        if not os.path.isfile(os.path.join(d, "Cargo.toml")):
            continue
        try:
            env = {k: v for k, v in os.environ.items() if k not in ("RUSTFLAGS", "CARGO_TARGET_DIR")}
            cmd = ["cargo", "metadata", "--format-version", "1"] + ([] if online else ["--offline"])
            r = subprocess.run(cmd, cwd=d, env=env, capture_output=True, text=True, timeout=900)
            if r.returncode == 0:
                ok = True
                for p in json.loads(r.stdout).get("packages", []):
                    pkgs[p["id"]] = p
            else:
                print(f"cargo metadata failed in {d}: {r.stderr[-300:]}", file=sys.stderr)
        except Exception as e:
            print(f"cargo metadata error in {d}: {e}", file=sys.stderr)
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


def config_only(src):
    fails, warns = hard_checks(src, git_entries(src))
    print(json.dumps({"fail": fails, "config": warns}, indent=1))
    return 2 if fails else 0


def main(src, wd, onchain_json, out_path):
    onchain = None
    if onchain_json != "-" and os.path.exists(onchain_json):
        onchain = json.load(open(onchain_json)).get("onchain_sha256")
    entries = git_entries(src)
    files = [rel for mode, rel in entries if mode != "120000"]
    fails, config_warns = hard_checks(src, entries)
    committed, blobs, includes, patch_git, scrubbed, all_build_rs, proc_macros = {}, [], [], [], [], [], []
    num_files, num_total, hex_files, small_bin, numeric = [], 0, [], [], []
    for rel in files:
        p = os.path.join(src, rel)
        if not os.path.isfile(p) or os.path.islink(p):
            continue
        data = open(p, "rb").read()
        h = hashlib.sha256(data).hexdigest()
        committed[rel] = h
        ext = os.path.splitext(rel)[1].lower()
        is_bin = NUL in data[:8192]
        if ext == ".wasm" or data[:4] == WASM_MAGIC:
            blobs.append(f"{rel} ({len(data)} bytes, wasm)")
        elif len(data) > BIG and not media_ok(ext, data):
            if is_bin or ext not in TEXT_OK:
                blobs.append(f"{rel} ({len(data)} bytes, binary)")
            elif re.search(rb"[A-Za-z0-9+/=]{2000}|[0-9a-fA-F]{2000}", data):
                blobs.append(f"{rel} ({len(data)} bytes, contains a long base64/hex run)")
        elif is_bin and not media_ok(ext, data):
            small_bin.append((rel, len(data)))
        if not is_bin and len(data) < 8 * 1024 * 1024:
            best = 0
            for m in NUMRUN.finditer(data):
                best = max(best, len(NUMTOK.findall(m.group(0))))
            if best:
                num_files.append(rel)
                num_total += best
                if best >= NUM_FILE:
                    numeric.append(f"{rel}: numeric array/data ({best} values in one run)")
            if len(data) <= BIG:
                m = HEXRUN.search(data)
                if m:
                    hex_files.append(rel)
                    if len(m.group(0)) >= 4096:
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
            if re.search(r"^\s*proc[-_]macro\s*=\s*true", text, re.M):
                proc_macros.append(f"{os.path.dirname(rel) or '.'}/Cargo.toml (proc-macro crate)")
        if os.path.basename(rel) == "Cargo.lock" and 'source = "git+' in data.decode(errors="replace"):
            patch_git.append(f"{rel}: git source in lockfile")
        if ext == ".wasm" or (onchain and h == onchain):
            scrubbed.append(rel + (" (equals the on-chain binary)" if onchain and h == onchain else ""))
    if len(num_files) >= NUM_MANY or (len(num_files) > 1 and num_total >= NUM_TOTAL):
        numeric.append(f"{len(num_files)} files hold numeric runs totalling {num_total} values "
                       f"(possible split-up blob): " + ", ".join(num_files[:6]) + (" ..." if len(num_files) > 6 else ""))
    if len(hex_files) >= NUM_MANY:
        blobs.append(f"{len(hex_files)} files hold long hex/base64 runs (possible split-up blob): " + ", ".join(hex_files[:6]))
    sb_total = sum(n for _, n in small_bin)
    if len(small_bin) >= NUM_MANY or sb_total > BIG:
        blobs.append(f"{len(small_bin)} small binary files totalling {sb_total} bytes (possible split-up blob): "
                     + ", ".join(r for r, _ in small_bin[:6]))
    for s in scrubbed:
        try:
            os.remove(os.path.join(src, s.split(" (")[0]))
        except OSError:
            pass
    if fails:  # never hand a repo with a hostile cargo config to cargo
        build_rs, git_deps, scope = all_build_rs, [], "every committed build.rs (cargo not run: hard failure)"
    else:
        build_rs, git_deps = metadata_build_rs(src, wd, files)
        scope = "template crate and its path dependencies (cargo metadata)"
        if build_rs is None:
            build_rs, scope = all_build_rs, "every committed build.rs (cargo metadata unavailable for this recipe)"
    patch_git += [f"dependency {g}" for g in git_deps if not any(g.split()[0] in x for x in patch_git)]
    patch_git += [w for w in config_warns if "[patch]" in w]
    res = {"fail": fails, "build_rs": build_rs, "build_rs_scope": scope, "proc_macros": sorted(set(proc_macros)),
           "includes": includes, "blobs": blobs, "numeric": numeric, "patch_or_git": patch_git,
           "config": [w for w in config_warns if "[patch]" not in w], "scrubbed": scrubbed,
           "committed_count": len(committed), "committed": committed}
    json.dump(res, open(out_path, "w"), indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != "committed"}, indent=1))


if __name__ == "__main__":
    if sys.argv[1] == "--config-only":
        sys.exit(config_only(sys.argv[2]))
    main(*sys.argv[1:5])
