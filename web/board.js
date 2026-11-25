import { ONCHAIN, explorerTx, esc, short, fetchAttestations, registerNumbers, regNo } from "./lib.js";
import { reveal, countUp } from "./site.js";
import { makerMark, makerParts, standardMark, officeMark, dateMark, blankMark } from "./marks.js";

const el = document.querySelector("#board");
const STATUS = { clean: 0, warn: 1, bad: 2 };
const statusOf = (r) => (r.clean ? "clean" : r.match ? "warn" : "bad");
// Filter keys are kept stable for ?status= links.
const FILTERS = [
  ["all", "All entries", () => true],
  ["reproduced", "Hallmarked", (r) => r.match && !r.own],
  ["warnings", "Qualified", (r) => r.match && !r.clean && !r.own],
  ["not-reproduced", "Failed assay", (r) => !r.match && !r.own],
  ["own", "OneScan's own", (r) => r.own],
];

try {
  const [reg, att] = await Promise.all([fetch("data/registry.json", { cache: "no-cache" }).then((r) => r.json()),
    fetchAttestations().catch((e) => ({ error: String(e && e.message || e) }))]);
  const nums = registerNumbers(reg.records);
  // Office mark: a trusted-verifier attestation in the live registry whose hash equals the recorded on-chain hash.
  const attOf = (r) => {
    if (att.error) return { s: "unknown" };
    const a = att.byTemplate.get(r.template)?.[0];
    if (!a) return { s: "no" };
    return a.onchain_sha256 === r.onchain_sha256 ? { s: "yes", a } : { s: "differs" };
  };
  const all = Object.values(reg.records);
  const nAttested = all.filter((r) => attOf(r).s === "yes").length;
  const nOwnAttested = all.filter((r) => r.own && attOf(r).s === "yes").length;

  const office = (r) => {
    const { s } = attOf(r);
    if (s === "unknown") return `<span class="muted">registry unreadable</span>`;
    if (s === "no") return `<span class="muted">no office mark</span>`;
    if (s === "differs") return `<span class="red">attested hash differs</span>`;
    return ONCHAIN.attestTxTemplates.has(r.template) ? `office mark, <a class="mono" href="${explorerTx(ONCHAIN.attestTx)}" title="Open the attestation transaction on the Tari explorer">tx ${short(ONCHAIN.attestTx, 8)}</a>` : "office mark";
  };

  const minis = (r) => {
    const s = statusOf(r), o = attOf(r);
    const struck = o.s === "yes" && r.match;
    return `<span class="mini-row" aria-hidden="true">
      <span class="mini is-struck">${makerMark(r.author_public_key)}</span>
      <span class="mini ${s === "clean" ? "is-struck" : s === "warn" ? "is-qualified" : "is-cancelled"}">${standardMark(s === "clean" ? "struck" : s === "warn" ? "qualified" : "cancelled")}</span>
      <span class="mini ${struck ? "is-struck" : ""}">${struck ? officeMark() : blankMark("office")}</span>
      <span class="mini ${struck ? "is-struck" : ""}">${struck ? dateMark(o.a.epoch) : blankMark("date")}</span></span>`;
  };
  const marksLabel = (r) => {
    const s = statusOf(r), o = attOf(r);
    return `Marks: maker ${makerParts(r.author_public_key)?.initials || "unknown"}, standard ${s === "clean" ? "struck" : s === "warn" ? "qualified" : "cancelled"}, office ${o.s === "yes" && r.match ? "struck" : "not struck"}`;
  };

  const row = (r) => {
    const repo = (r.repo || "").replace("https://github.com/", "");
    const s = statusOf(r), w = (r.warnings || []).length;
    const std = s === "clean" ? `<span class="std ok">Hallmarked</span>` : s === "warn" ? `<span class="std warn">Hallmarked, qualified</span>` : `<span class="std bad">Failed assay</span>`;
    const note = r.match
      ? (w ? `<span class="brass">${w} warning${w > 1 ? "s" : ""}:</span> ${esc(r.warnings[0])}${w > 1 ? ` <span class="muted">(+${w - 1} more)</span>` : ""}` : `<span class="muted">byte-identical, no warnings</span>`)
      : esc(r.cause);
    return `<tr class="s-${s}">
      <td class="c-no" data-l="Register">${esc(regNo(nums.get(r.template)))}</td>
      <td class="c-marks" data-l="Marks"><span class="sr">${esc(marksLabel(r))}</span>${minis(r)}</td>
      <td class="c-name"><a href="./?t=${r.template}">${esc(r.name)}</a>${r.own ? ` <span class="own">OneScan's own</span>` : ""}<span class="sig">template_${short(r.template, 8)}</span></td>
      <td class="c-std" data-l="Standard">${std}${r.match ? `<span class="sig">${esc(r.mode)}</span>` : ""}</td>
      <td class="c-note" data-l="Assayer's note" ${w > 1 ? `title="${esc(r.warnings.join("\n"))}"` : ""}>${note}</td>
      <td class="c-src" data-l="Maker and source"><a href="${esc(r.repo)}/tree/${esc(r.commit)}">${esc(repo)}</a><span class="sig">@ ${esc((r.commit || "").slice(0, 10))}</span><span class="sig">key ${short(r.author_public_key, 10)}</span></td>
      <td class="c-ev" data-l="Evidence"><a href="${esc(r.run_url)}" title="GitHub Actions run">run ${esc((r.run_url || "").split("/").pop())}</a><span class="sig">${office(r)}</span></td></tr>`;
  };

  const params = new URLSearchParams(location.search);
  let filter = FILTERS.some((f) => f[0] === params.get("status")) ? params.get("status") : "all";
  let sort = { key: "status", dir: 1 };

  const warnN = reg.reproduced - reg.clean;
  const badN = reg.attempted - reg.reproduced;
  el.innerHTML = `<dl class="totals reveal">
      <div><dt>Entered</dt><dd><span id="s-att">${reg.attempted}</span><small>third-party templates</small></dd></div>
      <div><dt>Hallmarked</dt><dd class="ok"><span id="s-rep">${reg.reproduced}</span><small>${reg.clean} clean, ${warnN} qualified</small></dd></div>
      <div><dt>Failed assay</dt><dd><span id="s-bad">${badN}</span><small>each with a diagnosed reason</small></dd></div>
      <div><dt>Office marks</dt><dd><span id="s-off">${att.error ? "unread" : nAttested}</span><small>${att.error ? "registry could not be read" : `read live, ${nOwnAttested} of them OneScan's own`}</small></dd></div>
    </dl>
    <div class="toolbar"><div class="chips" role="group" aria-label="Filter by standard">${FILTERS.map(([k, label, fn]) =>
      `<button type="button" data-f="${k}" aria-pressed="${k === filter}">${label}<span class="c">${all.filter(fn).length}</span></button>`).join("")}</div>
      <span class="count-note" id="shown"></span></div>
    <table class="ledger-t"><caption class="sr">The register of assayed templates</caption><thead><tr>
      <th aria-sort="none" data-k="no" scope="col"><button type="button">No.</button></th>
      <th scope="col">Marks</th>
      <th aria-sort="none" data-k="name" scope="col"><button type="button">Template</button></th>
      <th aria-sort="ascending" data-k="status" scope="col"><button type="button">Standard</button></th>
      <th scope="col">Assayer's note</th><th scope="col">Maker and source</th><th scope="col">Evidence</th></tr></thead>
    <tbody id="rows"></tbody></table>
    <div class="board-notes">
    <p class="note">The OneScan author's own templates (${all.filter((r) => r.own).map((r) => esc(r.name)).join(", ")}) are listed but not counted in the totals. Entries without public source are not listed yet.</p>
    <p class="note">Office marks are read live from the SourceRegistry component <span class="mono">${esc(short(ONCHAIN.registry, 22))}</span>. Only attestations signed by the trusted key <span class="mono">${esc(short(ONCHAIN.trustedVerifier, 16))}</span> whose hash equals the recorded on-chain hash are marked. The date letter is the epoch of that attestation. Each certificate re-checks against the live bytes.${att.error ? " Registry read failed: " + esc(att.error) : ""}</p>
    <p class="notaudit"><strong>Hallmarked is not audited.</strong> It shows which commit built the bytes, not that the code is safe.</p>
    <p class="note">Last verifier run: ${esc(reg.generated)}. Data: <a href="https://github.com/Techkeyy/onescan-ootle/tree/main/registry">registry/</a>.</p></div>`;

  const render = () => {
    const fn = FILTERS.find((f) => f[0] === filter)[2];
    const cmp = sort.key === "name" ? (a, b) => a.name.localeCompare(b.name)
      : sort.key === "no" ? (a, b) => nums.get(a.template) - nums.get(b.template)
      : (a, b) => (a.own - b.own) || (STATUS[statusOf(a)] - STATUS[statusOf(b)]) || a.name.localeCompare(b.name);
    const list = all.filter(fn).sort((a, b) => sort.dir * cmp(a, b));
    document.querySelector("#rows").innerHTML = list.length ? list.map(row).join("") : `<tr class="empty-row"><td colspan="7">No entries under this standard.</td></tr>`;
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
  countUp(document.querySelector("#s-att"), reg.attempted);
  countUp(document.querySelector("#s-rep"), reg.reproduced);
  countUp(document.querySelector("#s-bad"), badN);
  if (!att.error) countUp(document.querySelector("#s-off"), nAttested);
} catch (e) {
  el.innerHTML = `<div class="slip" role="alert"><p class="slip-k sc">Register unavailable</p><p class="slip-t">Could not open the register.</p><p>${esc(e.message || e)}</p></div>`;
}
