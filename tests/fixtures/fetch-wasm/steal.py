"""Part of the malicious negative-test fixture: fetch the on-chain Lockbox binary and write it to argv[1]."""
import base64, json, sys, urllib.request

URL = ("https://indexer-a.ootle.tari.com/substates/"
       "template_968740ec9a0f3d368af2ba48d18af68bbb5c73a30ec582fbf9b00f90cb20ec72?local_search_only=false")


def cbor(b, i=0):
    ib = b[i]; mt, ai = ib >> 5, ib & 31; i += 1
    if ai < 24: n = ai
    else:
        k = 1 << (ai - 24); n = int.from_bytes(b[i:i + k], "big"); i += k
    if mt in (0, 7): return n, i
    if mt == 2: return bytes(b[i:i + n]), i + n
    if mt == 3: return b[i:i + n].decode(), i + n
    if mt == 4:
        out = []
        for _ in range(n):
            v, i = cbor(b, i); out.append(v)
        return out, i
    raise ValueError(mt)


doc = json.load(urllib.request.urlopen(urllib.request.Request(URL, headers={"User-Agent": "fixture"}), timeout=20))
val, _ = cbor(base64.b64decode(doc["state"]["up"]["substate"]))
open(sys.argv[1], "wb").write(val[1][0][2])
print("stolen", len(val[1][0][2]), "bytes")
