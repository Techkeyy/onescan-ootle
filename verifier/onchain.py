"""Fetch a template's on-chain WASM + author key from the Ootle indexer.

Usage: python -I verifier/onchain.py <template_hex> <out_dir>
Writes <out_dir>/onchain.wasm and <out_dir>/onchain.json. Reuses gate/read_template.py.
"""
import hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "gate"))
sys.path.insert(0, HERE)
import read_template  # noqa: E402  (gate C logic: indexer GET with custom User-Agent + CBOR decode)
import wasminfo  # noqa: E402


def fetch(template_hex):
    hx = template_hex.removeprefix("template_").lower()
    _, val = read_template.read(hx)
    tag, body = val
    if tag != 6:
        raise SystemExit(f"substate variant {tag} is not a Template (6)")
    inner = body[0]
    name, author, binary = inner[0], inner[1], inner[2]
    return hx, name, author.hex(), bytes(binary)


if __name__ == "__main__":
    hx, name, author, binary = fetch(sys.argv[1])
    out = sys.argv[2]
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, "onchain.wasm"), "wb").write(binary)
    info = {"template": hx, "name": name, "author_public_key": author,
            "onchain_sha256": hashlib.sha256(binary).hexdigest(), "onchain": wasminfo.summary(binary)}
    json.dump(info, open(os.path.join(out, "onchain.json"), "w"), indent=2)
    print(json.dumps(info, indent=2))
