"""Small WASM inspection helpers: section table, custom sections, leaked path strings."""
import hashlib, re


def leb(b, i):
    n = s = 0
    while True:
        x = b[i]; i += 1
        n |= (x & 0x7F) << s; s += 7
        if not x & 0x80:
            return n, i


SECTION_NAMES = {0: "custom", 1: "type", 2: "import", 3: "function", 4: "table", 5: "memory",
                 6: "global", 7: "export", 8: "start", 9: "element", 10: "code", 11: "data",
                 12: "datacount"}


def sections(b):
    """Return [(name, size, payload_bytes)] ; custom sections are named 'custom:<name>'."""
    assert b[:4] == b"\0asm", "not a wasm module"
    i, out = 8, []
    while i < len(b):
        sid = b[i]; i += 1
        size, i = leb(b, i)
        payload = b[i:i + size]
        name = SECTION_NAMES.get(sid, str(sid))
        if sid == 0:
            nl, j = leb(payload, 0)
            name = "custom:" + payload[j:j + nl].decode(errors="replace")
        out.append((name, size, payload))
        i += size
    return out


PATH_RE = re.compile(rb"(?:[A-Za-z]:\\\\?Users\\\\?[^\x00\"]{0,120}|/home/[^\x00\"]{0,120}|/Users/[^\x00\"]{0,120}"
                     rb"|/build/[^\x00\"]{0,120}|/rustc/[0-9a-f]{40}|/root/[^\x00\"]{0,120}"
                     rb"|[^\x00\"\s]{0,40}registry[\\/]src[\\/][^\x00\"]{0,80})")


def path_hints(b, limit=12):
    seen = []
    for m in PATH_RE.finditer(b):
        s = m.group(0)[:110].decode(errors="replace")
        # normalise: keep only the prefix up to the crate directory
        key = re.split(r"(?<=index\.crates\.io-[0-9a-f]{16})", s)[0]
        if key not in seen:
            seen.append(key)
        if len(seen) >= limit:
            break
    return seen


def summary(b):
    secs = sections(b)
    tdef = next((p for n, _, p in secs if n == "custom:tari_tdef"), None)
    return {
        "sha256": hashlib.sha256(b).hexdigest(),
        "size": len(b),
        "sections": [[n, s] for n, s, _ in secs],
        "tari_tdef_sha256": hashlib.sha256(tdef).hexdigest() if tdef is not None else None,
        "has_datacount": any(n == "datacount" for n, _, _ in secs),
        "path_hints": path_hints(b),
        "rustc_commit": _rustc(b),
    }


def _rustc(b):
    m = re.search(rb"/rustc/([0-9a-f]{40})", b)
    return m.group(1).decode() if m else None
