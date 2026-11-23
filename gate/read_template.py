"""OneScan gate C: read a template substate from the Ootle indexer.

Usage: python read_template.py <template_hex> [out.wasm]
Fetches GET {INDEXER}/substates/template_<hex>?local_search_only=false, base64-decodes
.state.up.substate (CBOR), and prints the author public key and the WASM sha256.
"""
import base64, hashlib, json, sys, urllib.request

INDEXER = "https://indexer-a.ootle.tari.com"


def cbor(b, i=0):
    """Minimal CBOR decoder (major types 0-5, 7). Returns (value, next_index)."""
    ib = b[i]; mt, ai = ib >> 5, ib & 31; i += 1
    if ai < 24: n = ai
    elif ai in (24, 25, 26, 27):
        k = 1 << (ai - 24); n = int.from_bytes(b[i:i + k], "big"); i += k
    elif ai == 31: raise ValueError("indefinite length not supported")
    else: raise ValueError("bad additional info")
    if mt == 0: return n, i
    if mt == 1: return -1 - n, i
    if mt == 2: return bytes(b[i:i + n]), i + n
    if mt == 3: return b[i:i + n].decode(), i + n
    if mt == 4:
        out = []
        for _ in range(n):
            v, i = cbor(b, i); out.append(v)
        return out, i
    if mt == 5:
        out = {}
        for _ in range(n):
            k, i = cbor(b, i); v, i = cbor(b, i); out[k if not isinstance(k, list) else str(k)] = v
        return out, i
    if mt == 7: return {20: False, 21: True, 22: None}.get(n, n), i
    raise ValueError("unsupported major type %d" % mt)


def read(template_hex):
    url = f"{INDEXER}/substates/template_{template_hex}?local_search_only=false"
    req = urllib.request.Request(url, headers={"User-Agent": "onescan/0.1", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        doc = json.load(r)
    raw = base64.b64decode(doc["state"]["up"]["substate"])
    val, end = cbor(raw)
    assert end == len(raw), "trailing bytes"
    return doc, val


if __name__ == "__main__":
    hx = sys.argv[1].removeprefix("template_")
    doc, val = read(hx)
    # Observed layout: [6 (SubstateValue::Template), [[name, author_pk(32B), binary(bytes), ...]]]
    tag, body = val
    inner = body[0]
    name, author, binary = inner[0], inner[1], inner[2]
    print("variant_tag", tag)
    print("fields", [type(x).__name__ + (f"[{len(x)}]" if isinstance(x, (bytes, str, list)) else f"={x}") for x in inner])
    print("name", name)
    print("author_public_key", author.hex())
    print("binary_len", len(binary))
    print("binary_sha256", hashlib.sha256(binary).hexdigest())
    if len(sys.argv) > 2:
        open(sys.argv[2], "wb").write(binary)
