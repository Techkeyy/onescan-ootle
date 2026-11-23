import { esc, short } from "./lib.js";

const el = document.querySelector("#board");
try {
  const reg = await fetch("data/registry.json", { cache: "no-cache" }).then((r) => r.json());
  const recs = Object.values(reg.records).sort((a, b) => (a.own - b.own) || (b.match - a.match) || a.name.localeCompare(b.name));
  const own = recs.filter((r) => r.own);
  const row = (r) => {
    const repo = (r.repo || "").replace("https://github.com/", "");
    return `<tr>
      <td><span class="dot ${r.match ? "ok" : "warn"}"></span><strong>${r.match ? "Reproduced" : "Not reproduced"}</strong>${r.match ? `<div class="sig">${esc(r.mode)}</div>` : `<div class="sig">${esc(r.cause)}</div>`}</td>
      <td><a href="./?t=${r.template}"><strong>${esc(r.name)}</strong></a>${r.own ? " (OneScan author's own)" : ""}<div class="sig">template_${short(r.template)}</div></td>
      <td><span class="mono">${short(r.author_public_key, 16)}</span></td>
      <td><a href="${esc(r.repo)}/tree/${esc(r.commit)}">${esc(repo)}</a><div class="sig">@ ${esc((r.commit || "").slice(0, 10))}</div></td>
      <td><a href="${esc(r.run_url)}">run</a></td></tr>`;
  };
  el.innerHTML = `<p class="headline"><span>${reg.reproduced} of ${reg.attempted}</span> third-party templates reproduced</p>
    <p class="lede">Each row is a November mainnet template with public source that OneScan tried to rebuild. Reproduced means a fresh build from the named commit is byte-identical to the template binary on chain.${own.length ? ` Ootle Split, the OneScan author's own entry, is listed last and not counted.` : ""} Entries without public source are not listed yet.</p>
    <table class="board"><thead><tr><th>Status</th><th>Template</th><th>Author key</th><th>Source</th><th>Evidence</th></tr></thead>
    <tbody>${recs.map(row).join("")}</tbody></table>
    <p class="notaudit"><strong>Reproduced is not audited.</strong> It shows which commit built the bytes, not that the code is safe.</p>
    <p class="note">Last verifier run: ${esc(reg.generated)}. Data: <a href="https://github.com/Techkeyy/onescan-ootle/tree/main/registry">registry/</a>.</p>`;
} catch (e) {
  el.innerHTML = `<div class="err" role="alert"><strong>Could not load the verification records.</strong><p style="margin:6px 0 0">${esc(e.message || e)}</p></div>`;
}
