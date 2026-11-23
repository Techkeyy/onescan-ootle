import { ONCHAIN, explorerTx, esc, short, fetchAttestations } from "./lib.js";

const el = document.querySelector("#board");
try {
  const [reg, att] = await Promise.all([fetch("data/registry.json", { cache: "no-cache" }).then((r) => r.json()),
    fetchAttestations().catch((e) => ({ error: String(e && e.message || e) }))]);
  // On-chain marker: a trusted-verifier attestation in the live registry whose hash equals the recorded on-chain hash.
  const onchain = (r) => {
    if (att.error) return `<span class="sig">registry unreadable</span>`;
    const a = att.byTemplate.get(r.template)?.[0];
    if (!a) return `<span class="sig">no</span>`;
    if (a.onchain_sha256 !== r.onchain_sha256) return `<span class="flag">hash differs</span>`;
    return ONCHAIN.attestTxTemplates.has(r.template) ? `<a href="${explorerTx(ONCHAIN.attestTx)}"><span class="dot ok"></span>attested</a>` : `<span class="dot ok"></span>attested`;
  };
  const recs = Object.values(reg.records).sort((a, b) => (a.own - b.own) || (b.match - a.match) || a.name.localeCompare(b.name));
  const own = recs.filter((r) => r.own);
  const row = (r) => {
    const repo = (r.repo || "").replace("https://github.com/", "");
    return `<tr>
      <td><span class="dot ${r.clean ? "ok" : "warn"}"></span><strong>${r.clean ? "Reproduced" : r.match ? "Reproduced, with warnings" : "Not reproduced"}</strong>${r.match ? `<div class="sig">${esc(r.mode)}${r.warnings.length ? " · " + r.warnings.length + " warning" + (r.warnings.length > 1 ? "s" : "") : ""}</div>` : `<div class="sig">${esc(r.cause)}</div>`}</td>
      <td><a href="./?t=${r.template}"><strong>${esc(r.name)}</strong></a>${r.own ? " (OneScan author's own)" : ""}<div class="sig">${short(r.template)}</div></td>
      <td><span class="mono">${short(r.author_public_key, 16)}</span></td>
      <td><a href="${esc(r.repo)}/tree/${esc(r.commit)}">${esc(repo)}</a><div class="sig">@ ${esc((r.commit || "").slice(0, 10))}</div></td>
      <td><a href="${esc(r.run_url)}">run</a></td>
      <td>${onchain(r)}</td></tr>`;
  };
  el.innerHTML = `<p class="headline"><span>${reg.reproduced} of ${reg.attempted}</span> third-party templates reproduced${reg.reproduced - reg.clean ? `, ${reg.reproduced - reg.clean} of them with warnings` : ""}</p>
    <p class="lede">Each row is a November mainnet template with public source that OneScan tried to rebuild. Reproduced means a fresh build from the named commit is byte-identical to the template binary on chain.${own.length ? ` The OneScan author's own templates (${own.map((r) => esc(r.name)).join(", ")}) are listed last and not counted.` : ""} Entries without public source are not listed yet.</p>
    <table class="board"><thead><tr><th>Status</th><th>Template</th><th>Author key</th><th>Source</th><th>Evidence</th><th>On-chain</th></tr></thead>
    <tbody>${recs.map(row).join("")}</tbody></table>
    <p class="note">On-chain: read live from the SourceRegistry component <span class="mono">${esc(short(ONCHAIN.registry, 22))}</span>. Only attestations signed by the trusted verifier key <span class="mono">${esc(short(ONCHAIN.trustedVerifier, 16))}</span> whose hash equals the recorded on-chain hash are marked; the lookup page re-checks against the live bytes.${att.error ? " Registry read failed: " + esc(att.error) : ""}</p>
    <p class="notaudit"><strong>Reproduced is not audited.</strong> It shows which commit built the bytes, not that the code is safe.</p>
    <p class="note">Last verifier run: ${esc(reg.generated)}. Data: <a href="https://github.com/Techkeyy/onescan-ootle/tree/main/registry">registry/</a>.</p>`;
} catch (e) {
  el.innerHTML = `<div class="err" role="alert"><strong>Could not load the verification records.</strong><p style="margin:6px 0 0">${esc(e.message || e)}</p></div>`;
}
