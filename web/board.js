import { ONCHAIN, PROOF, PRUNE_NOTE, receiptUrl, isHex64, safeRepo, safeRun, safeCommit, esc, short, fetchAttestations } from "./lib.js";
import { coverage, notice } from "./site.js";

const el = document.querySelector("#board");
const RANK = { clean: 0, warn: 1, bad: 2 };
const statusOf = (r) => (r.clean ? "clean" : r.match ? "warn" : "bad");
// Filter keys are kept stable for ?status= links.
const FILTERS = [
  ["all", "All", () => true],
  ["reproduced", "Byte for byte", (r) => r.clean && !r.own],
  ["warnings", "With warnings", (r) => r.match && !r.clean && !r.own],
  ["not-reproduced", "Not reproduced", (r) => !r.match && !r.own],
  ["own", "OneScan's own", (r) => r.own],
];
const SORTS = [["status", "Verdict"], ["newest", "Newest first"], ["name", "Name"]];

try {
  const [reg, att] = await Promise.all([
    fetch("data/registry.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`data/registry.json returned HTTP ${r.status}`); return r.json(); }),
    fetchAttestations().catch((e) => ({ error: String(e && e.message || e) })),
  ]);
  // An on-chain record counts only when the trusted key signed it and its hash equals the recorded on-chain hash.
  const attOf = (r) => {
    if (att.error) return "unknown";
    const a = att.byTemplate.get(r.template)?.[0];
    if (!a) return "no";
    return a.onchain_sha256 === r.onchain_sha256 ? "yes" : "differs";
  };
  const all = Object.values(reg.records);
  const nAttested = all.filter((r) => attOf(r) === "yes").length;

  const recorded = (r) => {
    const s = attOf(r);
    if (s === "unknown") return `<span>registry unreadable</span>`;
    if (s === "no") return `<span>not recorded on-chain</span>`;
    if (s === "differs") return `<span class="bad">attested hash differs</span>`;
    return ONCHAIN.attestTxTemplates.has(r.template)
      ? `<a href="${receiptUrl(ONCHAIN.attestTx)}" title="Receipt of the attestation transaction. ${esc(PRUNE_NOTE)}">recorded on-chain</a>` : `<span>recorded on-chain</span>`;
  };

  const repoCell = (r) => {
    const u = safeRepo(r.repo), c = safeCommit(r.commit), name = esc(String(r.repo || "").replace("https://github.com/", ""));
    return u ? `<a href="${esc(u)}${c ? "/tree/" + esc(c) : ""}">${name}</a>` : `<span>${name}</span>`;
  };
  const runCell = (r) => {
    const u = safeRun(r.run_url), n = esc(String(r.run_url || "").split("/").pop());
    return u ? `<a href="${esc(u)}" title="GitHub Actions run">run ${n}</a>` : `<span>run ${n}</span>`;
  };
  const row = (r) => {
    const s = statusOf(r), w = (r.warnings || []).length, t = esc(r.template);
    const word = s === "clean" ? `<span class="st ok">Byte for byte</span>` : s === "warn" ? `<span class="st warn">With warnings</span>` : `<span class="st bad">Not reproduced</span>`;
    const why = r.match ? (w ? `${w} warning${w > 1 ? "s" : ""}: ${esc(r.warnings.join("; "))}` : "") : `Diagnosis: ${esc(r.cause)}`;
    return `<li class="prow">
      <span style="min-width:0">${isHex64(r.template) ? `<a class="nm" href="./?t=${t}">${esc(r.name)}</a>` : `<span class="nm">${esc(r.name)}</span>`}${r.own ? `<span class="chip own">OneScan's own</span>` : ""}
        <span class="addr" title="template_${t}">template_${esc(short(r.template, 12))}${esc(String(r.template).slice(-8))}</span></span>
      <span class="meta">${word}${r.match ? `<span>${esc(r.mode)}</span>` : ""}
        ${repoCell(r)}
        <span class="mono">${esc((r.commit || "").slice(0, 7))}</span>
        ${runCell(r)}
        ${recorded(r)}<span>${esc(String(r.verified_at || "").slice(0, 10))}</span></span>
      ${why ? `<span class="why">${why}</span>` : ""}</li>`;
  };

  const params = new URLSearchParams(location.search);
  const asked = params.get("status");
  const badFilter = asked !== null && !FILTERS.some((f) => f[0] === asked);
  let filter = asked !== null && !badFilter ? asked : "all";
  let sort = "status";

  el.innerHTML = `${badFilter ? `<div class="mt-4">${notice("warn", "Unknown filter", `<p>There is no filter called <code>${esc(asked)}</code>. Showing all templates. Valid filters: ${FILTERS.map((f) => `<code>${f[0]}</code>`).join(", ")}.</p>`, "status")}</div>` : ""}<div class="cov mt-4" style="max-width:48rem">${coverage(reg)}
      <p class="muted">${att.error ? `On-chain records could not be read: ${esc(att.error)}` : `<b>${nAttested}</b> of these are recorded on-chain by the trusted key, read live just now.`}</p></div>
    <div class="toolbar"><div class="filters" role="group" aria-label="Filter by verdict">${FILTERS.map(([k, label, fn]) =>
      `<button type="button" class="chip" data-f="${k}" aria-pressed="${k === filter}">${label} <span class="c">${all.filter(fn).length}</span></button>`).join("")}</div>
      <label class="sortby">Sort <select id="sort">${SORTS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label></div>
    <p class="mt-3 small muted" id="shown" role="status"></p>
    <ul class="plist" id="rows"></ul>
    <div class="notes-list">
      <p>The OneScan author's own templates (${all.filter((r) => r.own).map((r) => esc(r.name)).join(", ")}) are listed but not counted in the totals. Templates without public source are not listed yet. "Byte for byte" counts only clean matches; matches with warnings have their own filter.</p>
      <p>On-chain records are read live from the SourceRegistry component <a class="link mono" href="${PROOF.explorerComponent}">${esc(short(ONCHAIN.registry, 22))}</a> (<a class="link" href="${esc(PROOF.indexerComponent)}">raw substate</a>). ${esc(PRUNE_NOTE)} Only attestations signed by the trusted key <span class="mono">${esc(short(ONCHAIN.trustedVerifier, 16))}</span> whose hash equals the recorded on-chain hash are counted. Each check page compares again against the live bytes.</p>
      <p>Last verifier run: ${esc(reg.generated)}. Data: <a class="link" href="https://github.com/Techkeyy/onescan-ootle/tree/main/registry">registry/</a>.</p>
      ${notice("warn", "Verified source is not an audit", "<p>A match shows which commit built the bytes, not that the code is safe.</p>")}
    </div>`;

  const render = () => {
    const fn = FILTERS.find((f) => f[0] === filter)[2];
    const cmp = sort === "name" ? (a, b) => a.name.localeCompare(b.name)
      : sort === "newest" ? (a, b) => String(b.verified_at).localeCompare(String(a.verified_at)) || a.name.localeCompare(b.name)
      : (a, b) => (a.own - b.own) || (RANK[statusOf(a)] - RANK[statusOf(b)]) || a.name.localeCompare(b.name);
    const list = all.filter(fn).sort(cmp);
    document.querySelector("#rows").innerHTML = list.length ? list.map(row).join("") : `<li class="empty-row">No templates with this verdict.</li>`;
    document.querySelector("#shown").textContent = `${list.length} of ${all.length} shown`;
  };
  render();

  el.querySelector(".filters").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-f]");
    if (!b) return;
    filter = b.dataset.f;
    el.querySelectorAll(".filters button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    const u = new URL(location.href);
    if (filter === "all") u.searchParams.delete("status"); else u.searchParams.set("status", filter);
    history.replaceState(null, "", u);
    render();
  });
  el.querySelector("#sort").addEventListener("change", (ev) => { sort = ev.target.value; render(); });
} catch (e) {
  el.innerHTML = `<div class="mt-6">${notice("bad", "Could not load the proofs", `<p>${esc(e.message || e)}</p>`, "alert")}</div>
    <div class="actions"><a class="btn" href="board.html">Try again</a><a class="btn" href="./?check">Check a template</a></div>`;
}
