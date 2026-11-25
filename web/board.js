import { ONCHAIN, explorerTx, esc, short, fetchAttestations } from "./lib.js";
import { reveal, countUp } from "./site.js";

const el = document.querySelector("#board");
const STATUS = { clean: 0, warn: 1, bad: 2 };
const statusOf = (r) => (r.clean ? "clean" : r.match ? "warn" : "bad");
const FILTERS = [
  ["all", "All", () => true],
  ["reproduced", "Reproduced", (r) => r.match && !r.own],
  ["warnings", "With warnings", (r) => r.match && !r.clean && !r.own],
  ["not-reproduced", "Not reproduced", (r) => !r.match && !r.own],
  ["own", "OneScan's own", (r) => r.own],
];

try {
  const [reg, att] = await Promise.all([fetch("data/registry.json", { cache: "no-cache" }).then((r) => r.json()),
    fetchAttestations().catch((e) => ({ error: String(e && e.message || e) }))]);
  // On-chain marker: a trusted-verifier attestation in the live registry whose hash equals the recorded on-chain hash.
  const attested = (r) => {
    if (att.error) return "unknown";
    const a = att.byTemplate.get(r.template)?.[0];
    if (!a) return "no";
    return a.onchain_sha256 === r.onchain_sha256 ? "yes" : "differs";
  };
  const onchain = (r) => {
    const s = attested(r);
    if (s === "unknown") return `<span class="chip muted">registry unreadable</span>`;
    if (s === "no") return `<span class="sig">not attested</span>`;
    if (s === "differs") return `<span class="chip bad">hash differs</span>`;
    const chip = `<span class="chip ok"><span class="dot ok" style="margin:0"></span>attested</span>`;
    return ONCHAIN.attestTxTemplates.has(r.template) ? `<a href="${explorerTx(ONCHAIN.attestTx)}" title="Open the attestation transaction on the Tari explorer" style="text-decoration:none">${chip}</a>` : chip;
  };
  const all = Object.values(reg.records);
  const third = all.filter((r) => !r.own);
  const nAttested = all.filter((r) => attested(r) === "yes").length;

  const row = (r) => {
    const repo = (r.repo || "").replace("https://github.com/", "");
    const s = statusOf(r), w = (r.warnings || []).length;
    const chip = s === "clean" ? `<span class="chip ok">Reproduced</span>` : s === "warn" ? `<span class="chip warn">Reproduced · ${w} warning${w > 1 ? "s" : ""}</span>` : `<span class="chip bad">Not reproduced</span>`;
    const detail = r.match
      ? `<div class="sig" style="margin-top:6px">${esc(r.mode)}</div>${w ? `<div class="cause" title="${esc(r.warnings.join("\n"))}">${esc(r.warnings[0])}${w > 1 ? ` (+${w - 1} more)` : ""}</div>` : ""}`
      : `<div class="cause">${esc(r.cause)}</div>`;
    return `<tr>
      <td class="c-status">${chip}${detail}</td>
      <td class="c-name"><a href="./?t=${r.template}"><strong>${esc(r.name)}</strong></a>${r.own ? ` <span class="chip muted">OneScan's own</span>` : ""}<div class="sig">template_${short(r.template)}</div></td>
      <td data-l="Author key" class="nowrap"><span class="sig">${short(r.author_public_key, 16)}</span></td>
      <td data-l="Source"><a href="${esc(r.repo)}/tree/${esc(r.commit)}">${esc(repo)}</a><div class="sig">@ ${esc((r.commit || "").slice(0, 10))}</div></td>
      <td data-l="Evidence" class="nowrap"><a href="${esc(r.run_url)}">run ${esc((r.run_url || "").split("/").pop())}</a></td>
      <td data-l="On-chain">${onchain(r)}</td></tr>`;
  };

  const params = new URLSearchParams(location.search);
  let filter = FILTERS.some((f) => f[0] === params.get("status")) ? params.get("status") : "all";
  let sort = { key: "status", dir: 1 };

  const warnN = reg.reproduced - reg.clean;
  el.innerHTML = `<div class="stats reveal">
      <div><b class="acc"><span id="s-rep">${reg.reproduced}</span><small> / ${reg.attempted}</small></b><span>third-party reproduced</span></div>
      <div><b id="s-clean">${reg.clean}</b><span>clean</span></div>
      <div><b id="s-warn">${warnN}</b><span>with warnings</span></div>
      <div><b id="s-bad">${reg.attempted - reg.reproduced}</b><span>not reproduced, diagnosed</span></div>
      <div><b id="s-att">${att.error ? "–" : nAttested}</b><span>attested on-chain, live</span></div>
    </div>
    <div class="toolbar"><div class="chips" role="group" aria-label="Filter by status">${FILTERS.map(([k, label, fn]) =>
      `<button type="button" data-f="${k}" aria-pressed="${k === filter}">${label}<span class="c">${all.filter(fn).length}</span></button>`).join("")}</div>
      <span class="count-note" id="shown"></span></div>
    <table class="board"><thead><tr>
      <th aria-sort="ascending" data-k="status"><button type="button">Status</button></th>
      <th aria-sort="none" data-k="name"><button type="button">Template</button></th>
      <th>Author key</th><th>Source</th><th>Evidence</th><th>On-chain</th></tr></thead>
    <tbody id="rows"></tbody></table>
    <p class="note">The OneScan author's own templates (${all.filter((r) => r.own).map((r) => esc(r.name)).join(", ")}) are not counted in the totals. Entries without public source are not listed yet.</p>
    <p class="note">On-chain: read live from the SourceRegistry component <span class="mono">${esc(short(ONCHAIN.registry, 22))}</span>. Only attestations signed by the trusted verifier key <span class="mono">${esc(short(ONCHAIN.trustedVerifier, 16))}</span> whose hash equals the recorded on-chain hash are marked; the scan page re-checks against the live bytes.${att.error ? " Registry read failed: " + esc(att.error) : ""}</p>
    <p class="notaudit"><strong>Reproduced is not audited.</strong> It shows which commit built the bytes, not that the code is safe.</p>
    <p class="note">Last verifier run: ${esc(reg.generated)}. Data: <a href="https://github.com/Techkeyy/onescan-ootle/tree/main/registry">registry/</a>.</p>`;

  const render = () => {
    const fn = FILTERS.find((f) => f[0] === filter)[2];
    const cmp = sort.key === "name"
      ? (a, b) => a.name.localeCompare(b.name)
      : (a, b) => (a.own - b.own) || (STATUS[statusOf(a)] - STATUS[statusOf(b)]) || a.name.localeCompare(b.name);
    const list = all.filter(fn).sort((a, b) => sort.dir * cmp(a, b));
    document.querySelector("#rows").innerHTML = list.length ? list.map(row).join("") : `<tr class="empty-row"><td colspan="6">No templates in this group.</td></tr>`;
    document.querySelector("#shown").textContent = `${list.length} of ${all.length} shown`;
  };
  render();

  el.querySelector(".chips").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-f]");
    if (!b) return;
    filter = b.dataset.f;
    el.querySelectorAll(".chips button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    const u = new URL(location.href);
    if (filter === "all") u.searchParams.delete("status"); else u.searchParams.set("status", filter);
    history.replaceState(null, "", u);
    render();
  });
  el.querySelector("thead").addEventListener("click", (ev) => {
    const th = ev.target.closest("th[data-k]");
    if (!th) return;
    sort = { key: th.dataset.k, dir: sort.key === th.dataset.k ? -sort.dir : 1 };
    el.querySelectorAll("th[data-k]").forEach((x) => x.setAttribute("aria-sort", x === th ? (sort.dir > 0 ? "ascending" : "descending") : "none"));
    render();
  });

  reveal(el);
  countUp(document.querySelector("#s-rep"), reg.reproduced);
  countUp(document.querySelector("#s-clean"), reg.clean);
  countUp(document.querySelector("#s-warn"), warnN);
  countUp(document.querySelector("#s-bad"), reg.attempted - reg.reproduced);
  if (!att.error) countUp(document.querySelector("#s-att"), nAttested);
} catch (e) {
  el.innerHTML = `<div class="err" role="alert"><strong>Could not load the verification records.</strong><p style="margin:6px 0 0">${esc(e.message || e)}</p></div>`;
}
