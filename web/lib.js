// OneScan shared helpers: indexer fetch, CBOR decode, WASM sections, tari_tdef ABI parsing.
export const INDEXER = "https://indexer-a.ootle.tari.com";
export const SITE = "https://techkeyy.github.io/onescan-ootle/";
export const REPO = "Techkeyy/onescan-ootle";

export const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const short = (h, n = 12) => (h ? h.slice(0, n) + "…" : "");

export function parseAddress(input) {
  const s = String(input || "").trim().toLowerCase().replace(/^template_/, "");
  return /^[0-9a-f]{64}$/.test(s) ? s : null;
}

// Minimal CBOR decoder (major types 0-7), a port of gate/read_template.py.
export function cbor(b, i = 0) {
  const ib = b[i++], mt = ib >> 5, ai = ib & 31;
  let n;
  if (ai < 24) n = ai;
  else if (ai >= 24 && ai <= 27) {
    const k = 1 << (ai - 24); let v = 0n;
    for (let j = 0; j < k; j++) v = (v << 8n) | BigInt(b[i + j]);
    i += k; n = v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
  } else throw new Error("unsupported CBOR length encoding");
  switch (mt) {
    case 0: return [n, i];
    case 1: return [-1 - Number(n), i];
    case 2: return [b.subarray(i, i + n), i + n];
    case 3: return [new TextDecoder().decode(b.subarray(i, i + n)), i + n];
    case 4: { const out = []; for (let k = 0; k < n; k++) { let v; [v, i] = cbor(b, i); out.push(v); } return [out, i]; }
    case 5: { const out = new Map(); for (let k = 0; k < n; k++) { let kk, v; [kk, i] = cbor(b, i); [v, i] = cbor(b, i); out.set(kk, v); } return [out, i]; }
    case 6: return cbor(b, i); // tag: return the tagged value
    case 7: return [{ 20: false, 21: true, 22: null }[n] ?? n, i];
  }
}

// Fetch template_<hex> from the indexer. Returns {name, author, binary, epoch} or throws {kind}.
// onStep("fetched", {size, epoch, name}) fires once the bytes are decoded, before hashing.
export async function fetchTemplate(hx, onStep) {
  let res;
  try {
    res = await fetch(`${INDEXER}/substates/template_${hx}?local_search_only=false`, { headers: { Accept: "application/json" } });
  } catch (e) {
    throw { kind: "network", message: String(e && e.message || e) };
  }
  if (res.status === 404) throw { kind: "notfound" };
  if (!res.ok) throw { kind: "http", message: `indexer returned HTTP ${res.status}` };
  const doc = await res.json();
  const raw = Uint8Array.from(atob(doc.state.up.substate), (c) => c.charCodeAt(0));
  const [val] = cbor(raw);
  // Observed layout: [6 (SubstateValue::Template), [[name, author_pk(32B), binary, epoch]]]
  if (!Array.isArray(val) || val[0] !== 6) throw { kind: "shape", message: "substate is not a template" };
  const [name, author, binary, epoch] = val[1][0];
  if (onStep) onStep("fetched", { size: binary.length, epoch, name });
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", binary));
  return { name, author: hex(author), binary, size: binary.length, epoch, sha256: hex(digest), version: doc.version };
}

function leb(b, i) { let r = 0, s = 0, x; do { x = b[i++]; r += (x & 127) * 2 ** s; s += 7; } while (x & 128); return [r, i]; }

export function customSection(b, want) {
  if (b[0] !== 0 || b[1] !== 0x61 || b[2] !== 0x73 || b[3] !== 0x6d) return null;
  let i = 8;
  while (i < b.length) {
    const id = b[i++]; let n; [n, i] = leb(b, i); const end = i + n;
    if (id === 0) {
      let nl, j; [nl, j] = leb(b, i);
      if (new TextDecoder().decode(b.subarray(j, j + nl)) === want) return b.subarray(j + nl, end);
    }
    i = end;
  }
  return null;
}

// Type and WellKnownType numbering from tari-ootle crates/template_abi/src/template_def.rs.
const PRIM = ["()", "bool", "i8", "i16", "i32", "i64", "i128", "u8", "u16", "u32", "u64", "u128", "String"];
const WELL_KNOWN = ["Amount", "Bucket", "Proof", "ComponentAddress", "ResourceAddress", "VaultId", "NonFungibleId",
  "NonFungibleAddress", "UtxoAddress", "TemplateAddress", "Hash32", "Metadata", "Bytes", "RistrettoPublicKeyBytes",
  "ResourceType", "OwnerRule", "AccessRule", "ConfidentialWithdrawProof", "ResourceAuthAction", "AuthHookCaller", "SpendContext"];

export function typeName(t) {
  if (!Array.isArray(t)) return "?";
  const [tag, p] = t;
  if (tag < PRIM.length) return PRIM[tag];
  switch (tag) {
    case 13: return `Vec<${typeName(p[0])}>`;
    case 14: return `(${(p[0] || []).map(typeName).join(", ")})`;
    case 15: return String(p[0]);
    case 16: return `Option<${typeName(p[0])}>`;
    case 17: return WELL_KNOWN[p[0]] ?? `WellKnown#${p[0]}`;
  }
  return `Type#${tag}`;
}

// tari_tdef = u32 LE length + CBOR TemplateDef::V2 {template_name, abi_version, functions:[{name, kind, arguments, output}]}
export function parseTdef(binary) {
  const sec = customSection(binary, "tari_tdef");
  if (!sec) return { error: "no tari_tdef section" };
  try {
    const len = sec[0] | (sec[1] << 8) | (sec[2] << 16) | (sec[3] << 24);
    const [v] = cbor(sec.subarray(4, 4 + len));
    const def = v[1][0];
    const fns = def[2].map(([name, kind, args, output]) => {
      const k = kind[0] === 0 ? "function" : kind[0] === 1 ? (kind[1][0] === 1 ? "&mut self" : "&self") : "migration";
      const a = args.map(([n, t]) => [n, typeName(t)]);
      const out = typeName(output);
      return { name, kind: k, args: a, output: out, flags: flagsFor(name, k, a, out) };
    });
    return { template: def[0], abi: def[1], functions: fns };
  } catch (e) {
    return { error: "could not decode tari_tdef: " + (e.message || e) };
  }
}

const has = (s, w) => new RegExp(`\\b${w}\\b`).test(s);
function flagsFor(name, kind, args, out) {
  const f = [];
  const argTypes = args.map((a) => a[1]).join(" ");
  if (has(argTypes, "Bucket")) f.push(["takes tokens", "warn"]);
  if (has(out, "Bucket")) f.push(["releases tokens", "warn"]);
  if (has(argTypes, "ConfidentialWithdrawProof")) f.push(["withdraw proof", "warn"]);
  if (has(argTypes, "OwnerRule") || has(argTypes, "AccessRule")) f.push(["sets access rules", "warn"]);
  if (/(^|_)(admin|owner|set|pause|unpause|upgrade|migrate|config|update|withdraw|drain|sweep|mint|burn)(_|$)/.test(name)) f.push(["privileged-looking name", "warn"]);
  if (kind === "migration") f.push(["migration", "warn"]);
  if (kind === "function" && /Component</.test(out)) f.push(["constructor", "info"]);
  return f;
}

// On-chain attestations (Ootle mainnet). The registry accepts attestations from anyone; OneScan only
// counts entries whose verifier is the trusted key below.
export const ONCHAIN = {
  registryTemplate: "5b0efecc709ce6885b69738ce8f774f086ef0c6cb7b2a58920f8bab3e38f8b13",
  registry: "component_9f72dfb5c6994599299c2498cd17540573edff3b6773a94c6636763abf3153ea",
  trustedVerifier: "1a8baa583b0068359004ec094cd06f68b908ccae3bc2d41c46cd7a851e98e862",
  attestTx: "c86b139b3e04f4eaa9d310020802397c9ba53c41ad5c04f490f3bd30a9a5deec",
  // templates whose SourceAttested event is in attestTx (checked against the tx result)
  attestTxTemplates: new Set(["098accfc8e69ea08ea14e676ad0973fc1ccd6f3d8f677d5bb4cfc144049562b0",
    "54d64fdd5af8a40fe9331611e1f37f473c1bf670f32523e2b093d704e76e3983", "5b0efecc709ce6885b69738ce8f774f086ef0c6cb7b2a58920f8bab3e38f8b13",
    "6494a4fe7ea2de9276aada3b77086dfc14242fe4b96629a694745b24e49fb2d2", "67a658cc6c9e1c3564871e378f0a60d0b4f8682222460c34aa852caa961df309",
    "84f1d72f8b9e38d104e639de9fcce8d6f71098daa825c56ea0b2772d35f60580", "968740ec9a0f3d368af2ba48d18af68bbb5c73a30ec582fbf9b00f90cb20ec72",
    "9b41600aec8aaefb3c66e00567a060cafbb1e51fb4a904074f4faaabff6cb725", "ae13cead3c34052116c49fc09e4645f3a62edf55857c0e2e45226dd7093cef9c",
    "b3628ed057f88c73b88f3c5653b494a10258067c43cf0c667d1dcf17e85e9f45"]),
};
export const explorerTx = (tx) => `https://explorer.tari.mw/tx/${tx}`;

// Read the SourceRegistry component live from the indexer and decode its state.
// Returns Map<template hex, attestation[]> holding only attestations by the trusted verifier key.
// Observed layout: [0 (SubstateValue::Component), [[[template_addr, ...header], [[attestations_map, total]]]]],
// each attestation = [template, source_sha256, onchain_sha256, repo, commit, mode, toolchain, run_url, verifier(32B), epoch].
let attCache = null;
export function fetchAttestations() {
  attCache ??= (async () => {
    const res = await fetch(`${INDEXER}/substates/${ONCHAIN.registry}?local_search_only=false`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`indexer returned HTTP ${res.status} for the registry component`);
    const doc = await res.json();
    const [val] = cbor(Uint8Array.from(atob(doc.state.up.substate), (c) => c.charCodeAt(0)));
    if (!Array.isArray(val) || val[0] !== 0) throw new Error("registry substate is not a component");
    const [header, state] = val[1][0];
    if (hex(header[0]) !== ONCHAIN.registryTemplate) throw new Error("registry component is not an instance of the SourceRegistry template");
    const [map, total] = state[0];
    const out = new Map();
    for (const [key, list] of map) {
      const t = String(key).replace(/^template_/, "");
      const keep = list.map(([template, source_sha256, onchain_sha256, repo, commit, mode, toolchain, run_url, verifier, epoch]) =>
        ({ template, source_sha256, onchain_sha256, repo, commit, mode, toolchain, run_url, verifier: hex(verifier), epoch }))
        .filter((a) => a.verifier === ONCHAIN.trustedVerifier && a.template === `template_${t}`);
      if (keep.length) out.set(t, keep);
    }
    return { byTemplate: out, total, version: doc.version };
  })();
  attCache.catch(() => (attCache = null));
  return attCache;
}
