import { reveal, countUp, streaks, diffCount, reduced, whenVisible } from "./site.js";
import { SITE, REPO, ONCHAIN, explorerTx, esc, short, parseAddress, fetchTemplate, parseTdef, fetchAttestations, registerNumbers, regNo } from "./lib.js";
import { makerMark, makerParts, standardMark, officeMark, dateMark, dateParts, blankMark, strike } from "./marks.js";

const $ = (s, r = document) => r.querySelector(s);
const out = $("#result");
const outWrap = $("#result-wrap");
let registry = null;

async function loadRegistry() {
  if (!registry) registry = fetch("data/registry.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return registry;
}

const ghLink = (repo, commit) => {
  const name = (repo || "").replace("https://github.com/", "");
  return `<a href="${esc(repo)}/tree/${esc(commit)}">${esc(name)}</a> @ <a class="mono" href="${esc(repo)}/commit/${esc(commit)}">${esc((commit || "").slice(0, 10))}</a>`;
};
const runNo = (rec) => esc((rec.run_url || "").split("/").pop());

const MODE = {
  raw: "raw: the plain cargo/tari build output, unmodified",
  "walletd-optimized": "walletd-optimized: the build, then the wasm-opt pass that tari_walletd applies when publishing",
};
const MODE_SHORT = { raw: "raw build", "walletd-optimized": "walletd-optimized build" };

function rerunCmd(rec) {
  const r = rec.recipe || {};
  const parts = [`gh workflow run verify.yml -R <your-fork-of-onescan-ootle>`, `-f template=template_${rec.template}`];
  for (const k of ["repo", "commit", "rustc", "builder", "tari_cli", "script", "workdir", "remap", "rustflags", "optimizer"]) {
    if (r[k] && !(k === "optimizer" && r[k] === "auto")) parts.push(`-f ${k}='${String(r[k]).replace(/'/g, "'\\''")}'`);
  }
  if (rec.runner_os === "Windows") parts.push("-f os=windows-latest");
  if (r.cmd) parts.push(`-f cmd='${String(r.cmd).replace(/'/g, "'\\''")}'`);
  return parts.join(" \\\n  ");
}
const copyBtn = (text) => `<button type="button" class="copy" data-copy="${esc(text)}">Copy</button>`;

// ---------- certificate shell: marks start blank and are struck only as real evidence arrives ----------
const MARKS = [
  ["maker", "Maker's mark", "I"],
  ["standard", "Standard mark", "II"],
  ["office", "Office mark", "III"],
  ["date", "Date letter", "IV"],
];
const STEPS = [
  ["bytes", "Indexer read", "template substate from mainnet"],
  ["hash", "sha256 in your browser", "crypto.subtle"],
  ["rebuild", "Rebuild record", "offline CI run"],
  ["compare", "Byte comparison", "32 bytes each"],
  ["attest", "Registry read", "trusted key only"],
];

function shell(hx, rn) {
  return `<article class="cert" id="cert" data-v="run" aria-busy="true">
    <header class="cert-head">
      <div class="cert-id">
        <p class="cert-kicker"><span class="sc">Certificate of assay</span><span class="reg">${esc(regNo(rn))}</span></p>
        <h2 id="c-name">Reading the specimen</h2>
        <p class="mono addr">template_${esc(hx)}</p>
        <p class="cert-sum" id="c-sum">Each mark below is struck only when the check behind it returns.</p>
      </div>
      <div class="ink-stamp" id="c-stamp" aria-hidden="true"></div>
    </header>
    <div class="hallmarks" data-strip>
      ${MARKS.map(([k, label, n]) => `<div class="mk" data-m="${k}"><span class="slot-m">${blankMark(k)}</span>
        <div class="cap"><p class="cap-l"><span class="rn">${n}</span> ${label}</p><div class="cap-v" id="cap-${k}"><p class="pending">Not struck yet</p></div></div></div>`).join("")}
    </div>
    <div class="cert-grid">
      <section class="stone-wrap" aria-labelledby="stone-h">
        <h3 id="stone-h">Touchstone</h3>
        <p class="stone-key"><span><i class="k-up"></i>Upper streak: the on-chain bytes, hashed in your browser</span><span><i class="k-lo"></i>Lower streak: the build from source</span></p>
        <div class="stone" id="c-stone" role="img" aria-label="sha256 comparison not available yet">${streaks(null, null)}</div>
        <p class="stone-verdict" id="c-cmp">Awaiting both streaks</p>
        <dl class="hexes" id="c-hex"></dl>
      </section>
      <section class="log" aria-labelledby="log-h">
        <h3 id="log-h">Assay log</h3>
        <ol id="c-log">${STEPS.map(([k, t, d]) => `<li data-step="${k}" data-s=""><span class="st" aria-hidden="true"></span><span class="lt">${t}</span><span class="ld">${d}</span></li>`).join("")}</ol>
      </section>
    </div>
    <div class="cert-body" id="c-body"></div>
  </article>`;
}

const STATE_WORD = { run: "in progress", ok: "done", warn: "done, with a caveat", fail: "failed", skip: "not run" };
function step(n, s, detail) {
  const li = $(`#c-log [data-step="${n}"]`);
  if (!li) return;
  li.dataset.s = s;
  if (detail != null) { const d = $(".ld", li); d.textContent = detail; d.title = detail; }
  li.setAttribute("aria-label", `${$(".lt", li).textContent}: ${STATE_WORD[s] || "waiting"}${detail ? ", " + detail : ""}`);
}
function cap(k, html) { const el = $(`#cap-${k}`); if (el) el.innerHTML = html; }
function slot(k) { return $(`#cert .mk[data-m="${k}"] .slot-m`); }

const prints = { a: null, b: null, la: "", lb: "" };
function setStone(a, b, la, lb) {
  if (a !== undefined) { prints.a = a; prints.la = la || ""; }
  if (b !== undefined) { prints.b = b; prints.lb = lb || ""; }
  const stone = $("#c-stone");
  if (!stone) return;
  stone.innerHTML = streaks(prints.a, prints.b);
  stone.classList.toggle("has-a", !!prints.a); stone.classList.toggle("has-b", !!prints.b);
  const cmp = $("#c-cmp");
  cmp.className = "stone-verdict";
  let label = "sha256 comparison: ";
  if (prints.a && prints.b) {
    const n = diffCount(prints.a, prints.b);
    cmp.classList.add(n ? "bad" : "ok");
    cmp.textContent = n ? `The streaks diverge: ${n} of 32 bytes differ` : "The streaks align: 32 of 32 bytes equal";
    label += n ? `${n} of 32 bytes differ` : "all 32 bytes equal";
  } else {
    cmp.textContent = prints.a ? "No build from source to rub against" : prints.b ? "Awaiting the on-chain bytes" : "Awaiting both streaks";
    label += "incomplete";
  }
  stone.setAttribute("aria-label", label);
  $("#c-hex").innerHTML = [[prints.la, prints.a], [prints.lb, prints.b]].filter(([, v]) => v)
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="mono">${esc(v)}</dd></div>`).join("");
}

// ---------- the body of the certificate, written once the assay is complete ----------
function onchainFacts(hx, live, rec) {
  const author = live ? live.author : rec?.author_public_key;
  return `${live ? `<div><dt>Name on chain</dt><dd>${esc(live.name)}</dd></div>` : ""}
    ${author ? `<div><dt>Author public key</dt><dd class="mono wrapall">${esc(author)}${live ? "" : " (recorded)"}</dd></div>` : ""}
    ${live ? `<div><dt>Published at epoch</dt><dd>${esc(live.epoch)}</dd></div><div><dt>Binary size</dt><dd>${live.size.toLocaleString()} bytes</dd></div>` : ""}`;
}

function functionsBlock(live) {
  if (!live) return "";
  const t = parseTdef(live.binary);
  if (t.error) return `<section class="cb"><h3>What this metal can do</h3><p class="note">Could not list functions: ${esc(t.error)}.</p></section>`;
  const moves = t.functions.filter((f) => f.flags.some(([l]) => /tokens/.test(l))).length;
  const rows = t.functions.map((f) => `<tr><td><span class="fn mono">${esc(f.name)}</span><span class="sig">${esc(f.kind === "function" ? "" : f.kind + (f.args.length ? ", " : ""))}${f.args.map(([n, ty]) => esc(n) + ": " + esc(ty)).join(", ")} → ${esc(f.output)}</span></td>
    <td>${f.flags.map(([l, c]) => `<span class="flag ${c === "info" ? "info" : ""}">${esc(l)}</span>`).join("")}</td></tr>`).join("");
  return `<section class="cb"><h3>What this metal can do</h3>
    <p class="cb-lede">${t.functions.length} methods. ${moves} of them move funds: they take or release tokens.</p>
    <div class="tscroll"><table class="fns"><thead><tr><th scope="col">Method and signature</th><th scope="col">Flags</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">Decoded from the template's own <code>tari_tdef</code> ABI section in the on-chain bytes. Flags are hints from argument types and names. The ABI does not say who may call each method: access rules are set at runtime and are not shown here.</p></section>`;
}

const NOT_AUDIT = `<p class="notaudit"><strong>Verified source is not an audit.</strong> A hallmark proves which public commit built these bytes. It does not mean the code is safe.</p>`;

function badgeBlock(hx) {
  const md = `[![OneScan](https://img.shields.io/endpoint?url=${SITE}badge/${hx}.json)](${SITE}?t=${hx})`;
  return `<section class="cb"><h3>Badge for the README</h3>
    <p><img alt="OneScan badge for this template" height="20" src="https://img.shields.io/endpoint?url=${encodeURIComponent(SITE + "badge/" + hx + ".json")}"></p>
    <pre class="cmd"><code>${esc(md)}</code>${copyBtn(md)}</pre></section>`;
}

function rerunBlock(rec) {
  return `<section class="cb"><h3>Re-assay it yourself</h3>
    <pre class="cmd"><code>${esc(rerunCmd(rec))}</code>${copyBtn(rerunCmd(rec))}</pre>
    <p class="note">Runs the same public workflow in your fork of <a href="https://github.com/${REPO}">onescan-ootle</a>. The run fetches the template from the indexer and compares the hashes itself.</p></section>`;
}

function isolationFact(rec) {
  const i = rec.isolation;
  if (!i) return "not recorded (older run)";
  return (i.network_isolated ? "no network during the build" : "network not isolated") + (i.note ? ` (${esc(i.note)})` : "");
}

function attestedFact(hx, live, att) {
  if (!att) return "";
  let v;
  if (att.error) v = `Could not read the registry live: ${esc(att.error)}`;
  else {
    const a = att.byTemplate.get(hx)?.[0];
    if (!a) v = `No attestation by the trusted key in registry <span class="mono">${esc(short(ONCHAIN.registry, 22))}</span> yet.`;
    else if (!live) v = "An attestation exists, but the live bytes could not be read, so its hash was not compared. Not counted.";
    else if (a.onchain_sha256 !== live.sha256) v = `<span class="red">Hash differs:</span> the attestation names <span class="mono">${esc(short(a.onchain_sha256, 16))}</span>, the live bytes hash differently. Not counted.`;
    else v = `Yes, read live from registry <span class="mono" title="${esc(ONCHAIN.registry)}">${esc(short(ONCHAIN.registry, 22))}</span> at epoch ${esc(a.epoch)}, ${ONCHAIN.attestTxTemplates.has(hx) ? `<a class="mono" href="${explorerTx(ONCHAIN.attestTx)}">tx ${esc(short(ONCHAIN.attestTx, 12))}</a>` : "transaction not recorded here"}. Verifier <span class="mono" title="${esc(a.verifier)}">${esc(short(a.verifier, 16))}</span> (trusted). The attested hash equals the live hash.`;
  }
  return `<div><dt>Attested on chain</dt><dd>${v}</dd></div>`;
}

function requestForm(hx) {
  return `<form class="req" id="req" data-t="${hx}">
    <label>Source repository<input type="url" name="repo" required placeholder="https://github.com/owner/repo" pattern="https://github\\.com/[^/]+/[^/]+/?"></label>
    <div class="row"><label>Commit<input type="text" name="commit" required placeholder="a1b2c3d" pattern="[0-9a-fA-F]{7,40}"></label>
    <label>Crate sub-directory (optional)<input type="text" name="workdir" placeholder="contracts/my-template"></label></div>
    <div class="row"><label>Rust toolchain (optional)<input type="text" name="rustc" placeholder="1.98.1"></label>
    <label>CARGO_HOME remap (optional)<input type="text" name="remap" placeholder="/home/you/.cargo"></label></div>
    <div><button type="submit" class="primary">Submit for assay on GitHub</button></div>
    <p class="note">Opens a prefilled issue in ${REPO}. Submitting it starts a public GitHub Actions run that rebuilds the commit and posts the result on the issue. You need a GitHub account.</p>
  </form>`;
}

const notes = (list) => `<section class="cb"><h3>Assayer's notes</h3><ol class="notes">${list.map((n) => `<li><div>${n}</div></li>`).join("")}</ol></section>`;

function bodyVerified(hx, live, rec, liveErr, att) {
  const w = rec.warnings || [];
  const n = [];
  n.push(live ? "The bytes on chain right now are byte-identical to a reproducible build of this public commit." : "The verifier run matched the on-chain bytes. A live re-check could not run in this browser, so the touchstone shows the recorded hashes.");
  if (liveErr) n.push(esc(liveErr));
  for (const x of w) n.push(`<span class="brass">Qualified:</span> ${esc(x)}`);
  if (w.length) n.push("The bytes still match, but these weaken what the match proves. Build scripts and network access during a build could fetch or decode the on-chain binary instead of compiling it.");
  return `${notes(n)}
    <section class="cb"><h3>Particulars</h3><dl class="facts">
      <div><dt>Source</dt><dd>${ghLink(rec.repo, rec.commit)}</dd></div>
      <div><dt>Toolchain</dt><dd>${esc(rec.toolchain?.rustc || "")}${rec.toolchain?.tari_cli ? ", " + esc(rec.toolchain.tari_cli) : ""} on ${esc(rec.runner_os || "Linux")}</dd></div>
      <div><dt>Build mode</dt><dd>${esc(MODE[rec.mode] || rec.mode)}</dd></div>
      <div><dt>Verifier run</dt><dd><a href="${esc(rec.run_url)}">GitHub Actions run ${runNo(rec)}</a>, ${esc(rec.verified_at)}</dd></div>
      <div><dt>Build isolation</dt><dd>${isolationFact(rec)}</dd></div>
      ${attestedFact(hx, live, att)}
      ${onchainFacts(hx, live, rec)}
    </dl></section>
    ${functionsBlock(live)}${rerunBlock(rec)}${badgeBlock(hx)}${NOT_AUDIT}`;
}

function bodyFailed(hx, live, rec, liveErr) {
  return `${notes([`<strong>Diagnosis:</strong> ${esc(rec.cause)}.`, "OneScan rebuilt the claimed source and did not get these on-chain bytes. That does not mean the code is malicious. It means nobody has yet shown which source builds them.", ...(liveErr ? [esc(liveErr)] : [])])}
    <section class="cb"><h3>Particulars</h3><dl class="facts">
      <div><dt>Source tried</dt><dd>${ghLink(rec.repo, rec.commit)}</dd></div>
      <div><dt>Toolchain tried</dt><dd>${esc(rec.toolchain?.rustc || "")}${rec.toolchain?.tari_cli ? ", " + esc(rec.toolchain.tari_cli) : ""}</dd></div>
      ${rec.sizes && rec.sizes[0] ? `<div><dt>Sizes</dt><dd>${Number(rec.sizes[0]).toLocaleString()} bytes on chain, ${Number(rec.sizes[1]).toLocaleString()} bytes in the closest build</dd></div>` : ""}
      <div><dt>Verifier run</dt><dd><a href="${esc(rec.run_url)}">GitHub Actions run ${runNo(rec)}</a>, ${esc(rec.verified_at)}</dd></div>
      ${onchainFacts(hx, live, rec)}
    </dl></section>
    ${functionsBlock(live)}
    <section class="cb"><h3>Know the right commit?</h3>${requestForm(hx)}</section>
    ${badgeBlock(hx)}${NOT_AUDIT}`;
}

function bodyMismatch(hx, live, rec) {
  return `${notes(["A verifier run matched this template, but the bytes the indexer returns now hash differently. The hallmark is withdrawn: treat the source as unverified."])}
    <section class="cb"><h3>Particulars</h3><dl class="facts"><div><dt>Source on record</dt><dd>${ghLink(rec.repo, rec.commit)}</dd></div>${onchainFacts(hx, live, rec)}</dl></section>${NOT_AUDIT}`;
}

function bodyUnverified(hx, live) {
  return `${notes(["This template is live on Ootle mainnet, but nobody has shown which source builds these bytes. Only the maker's mark can be struck."])}
    <section class="cb"><h3>Particulars</h3><dl class="facts">${onchainFacts(hx, live)}</dl></section>
    ${functionsBlock(live)}
    <section class="cb"><h3>Submit for assay</h3>${requestForm(hx)}</section>${NOT_AUDIT}`;
}

function slip(title, msg, kind = "refused") {
  return `<div class="slip" role="alert"><p class="slip-k sc">${kind === "refused" ? "Specimen refused" : "Assay not possible"}</p><p class="slip-t">${esc(title)}</p><p>${msg}</p></div>`;
}

const STAMP = {
  ok: ["Hallmarked", "ok"], warn: ["Hallmarked", "warn", "qualified"], bad: ["Failed assay", "bad"],
  none: ["Unassayed", "none"], withdrawn: ["Withdrawn", "bad"],
};
function stamp(kind) {
  const [t, cls, sub] = STAMP[kind];
  const el = $("#c-stamp");
  el.className = `ink-stamp s-${cls}`;
  el.innerHTML = `<span>${t}</span>${sub ? `<small>${sub}</small>` : `<small>OneScan</small>`}`;
  if (!reduced) { void el.offsetWidth; el.classList.add("press"); }
  $("#cert").dataset.v = cls;
}

// ---------- the assay ----------
let runId = 0;
async function lookup(raw, opts = {}) {
  const hx = parseAddress(raw);
  const id = ++runId;
  const mine = () => id === runId;
  const msg = $("#slot-msg"), addr = $("#addr");
  const go = () => opts.scroll && outWrap.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  if (!hx) {
    // A refused specimen is answered at the slot, where the address can be corrected.
    addr.value = String(raw || "");
    addr.setAttribute("aria-invalid", "true");
    msg.innerHTML = `<span class="sc">Specimen refused</span> That is not a template address. Expected <code>template_</code> followed by 64 hex characters, or just the 64 hex characters.`;
    msg.hidden = false;
    outWrap.hidden = true;
    addr.focus({ preventScroll: true });
    if (opts.scroll) msg.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    return;
  }
  msg.hidden = true;
  addr.removeAttribute("aria-invalid");
  outWrap.hidden = false;
  history.replaceState(null, "", `?t=${hx}`);
  $("#addr").value = `template_${hx}`;
  $("#go").disabled = true;
  $("#go").textContent = "Assaying";
  const reg0 = await loadRegistry();
  if (!mine()) return;
  const rn = reg0 ? registerNumbers(reg0.records).get(hx) : null;
  out.innerHTML = shell(hx, rn);
  prints.a = prints.b = null;
  go();
  step("bytes", "run", "reading the indexer");
  step("hash", "", "waiting for bytes");
  step("rebuild", "run", "reading the register");
  step("compare", "", "waiting for both hashes");
  step("attest", "run", "reading the registry");

  const rec = reg0?.records?.[hx];
  if (!rec) step("rebuild", "skip", reg0 ? "never assayed" : "register unavailable");
  else {
    step("rebuild", rec.match && rec.clean ? "ok" : "warn", rec.match ? `run ${(rec.run_url || "").split("/").pop()}, ${rec.mode}${rec.clean ? "" : ", warnings"}` : `run ${(rec.run_url || "").split("/").pop()}, closest build`);
    setStone(undefined, rec.built_sha256, undefined, rec.match ? `Built from source (${rec.mode})` : "Closest build from source");
  }

  let makerFrom = null;
  const strikeMaker = (key, how) => {
    if (makerFrom || !key) return;
    makerFrom = how;
    const p = makerParts(key);
    strike(slot("maker"), makerMark(key), "is-struck");
    cap("maker", `<p class="cap-t">${esc(p.initials)}<span class="cap-sub">author key <span class="mono" title="${esc(key)}">${esc(short(key, 10))}</span></span></p>
      ${rec ? `<p>claims ${ghLink(rec.repo, rec.commit)}</p>` : `<p>no source claimed yet</p>`}<p class="cap-s">${how}</p>`);
  };

  const liveP = fetchTemplate(hx, (k, info) => {
    if (!mine()) return;
    step("bytes", "ok", `${info.size.toLocaleString()} bytes, epoch ${info.epoch}`);
    step("hash", "run", "hashing");
    $("#c-name").textContent = info.name;
    strikeMaker(info.author, "Struck from the indexer read");
  }).then((v) => {
    if (mine()) { step("hash", "ok", `${v.sha256.slice(0, 12)}…`); setStone(v.sha256, undefined, "On chain, read live and hashed here"); }
    return { v };
  }, (e) => {
    if (mine()) {
      step("bytes", "fail", e.kind === "notfound" ? "no template at this address" : e.kind === "shape" ? "not a template substate" : "indexer unreachable");
      step("hash", "skip", "no bytes to hash");
    }
    return { e };
  });
  const attP = fetchAttestations().catch((e) => ({ error: String(e && e.message || e) }));

  const lr = await liveP;
  if (!mine()) return;
  const live = lr.v, e = lr.e;

  if (e && e.kind === "notfound") {
    $("#go").disabled = false; $("#go").textContent = "Assay";
    out.innerHTML = slip("No template at this address on Ootle mainnet.", `The indexer returned 404 for <code>template_${esc(hx)}</code>. Check the address: component and resource addresses are not templates.`, "notfound");
    return;
  }
  let liveErr = "";
  if (e) {
    liveErr = `Live check unavailable: ${e.message || e.kind}.${rec ? " Showing the hashes recorded by the verifier run instead." : ""}`;
    if (!rec) {
      $("#go").disabled = false; $("#go").textContent = "Assay";
      out.innerHTML = slip("Could not read the template from the indexer.", esc(liveErr) + " There is no assay on record for this address either, so OneScan cannot say anything about it right now.", "notfound");
      return;
    }
    strikeMaker(rec.author_public_key, "Struck from the recorded author key (live read failed)");
    setStone(rec.onchain_sha256, undefined, "On chain, as recorded (live read failed)");
  }

  // Standard mark: needs both sides of the touchstone.
  let kind;
  if (!rec) {
    step("compare", "skip", "nothing to compare");
    cap("standard", `<p class="cap-s">Not struck: no build from source on record</p>`);
    kind = "none";
  } else {
    const a = live ? live.sha256 : rec.onchain_sha256;
    const n = diffCount(a, rec.built_sha256);
    if (live) step("compare", n ? "fail" : "ok", n ? `${n} of 32 bytes differ` : "32 of 32 bytes equal");
    else step("compare", "warn", rec.match ? "recorded hashes equal" : "recorded hashes differ");
    const w = (rec.warnings || []).length;
    if (n === 0 && rec.match) {
      kind = rec.clean ? "ok" : "warn";
      strike(slot("standard"), standardMark(rec.clean ? "struck" : "qualified"), rec.clean ? "is-struck" : "is-qualified");
      cap("standard", `<p class="cap-t">32 of 32<span class="cap-sub">${esc(MODE_SHORT[rec.mode] || rec.mode)}</span></p>
        ${rec.clean ? "" : `<p class="brass">qualified: ${w} warning${w > 1 ? "s" : ""}, see the notes</p>`}
        <p class="cap-s">${live ? "Struck from the live comparison" : "Struck from the recorded comparison"}</p>`);
    } else {
      kind = rec.match ? "withdrawn" : "bad";
      strike(slot("standard"), standardMark("cancelled"), "is-cancelled");
      cap("standard", `<p class="cap-t red">Cancelled<span class="cap-sub">${n} of 32 bytes differ</span></p>
        <p class="cap-s">${rec.match ? "The recorded match no longer holds" : "No build of the claimed source matched"}</p>`);
    }
  }

  // Office mark and date letter: a trusted-key attestation whose hash equals the live bytes.
  const att = await attP;
  if (!mine()) return;
  let officeOk = false;
  if (att.error) { step("attest", "fail", "registry unreadable"); cap("office", `<p class="cap-s">Not struck: the registry could not be read</p>`); }
  else {
    const a = att.byTemplate.get(hx)?.[0];
    if (!a) { step("attest", "skip", "no attestation"); cap("office", `<p class="cap-s">Not struck: no attestation by the trusted key</p>`); }
    else if (!live) { step("attest", "warn", "exists, not compared"); cap("office", `<p class="cap-s">Not struck: an attestation exists but the live bytes could not be compared</p>`); }
    else if (a.onchain_sha256 !== live.sha256) { step("attest", "fail", "attested hash differs"); cap("office", `<p class="cap-s red">Not struck: the attested hash differs from the live bytes</p>`); }
    else if (kind === "ok" || kind === "warn") {
      officeOk = true;
      step("attest", "ok", `attested at epoch ${a.epoch}`);
      strike(slot("office"), officeMark(), "is-struck");
      const tx = ONCHAIN.attestTxTemplates.has(hx) ? `<p>entry <a class="mono" href="${explorerTx(ONCHAIN.attestTx)}">tx ${esc(short(ONCHAIN.attestTx, 8))}</a></p>` : "";
      cap("office", `<p class="cap-t">SourceRegistry<span class="cap-sub">trusted key <span class="mono" title="${esc(a.verifier)}">${esc(short(a.verifier, 8))}</span></span></p>${tx}<p class="cap-s">Struck from the live registry read</p>`);
      const d = dateParts(a.epoch);
      const strikeDate = () => {
        if (!mine()) return;
        strike(slot("date"), dateMark(a.epoch), "is-struck");
        cap("date", `<p class="cap-t">${esc(d.letter)}<span class="cap-sub">epoch ${esc(a.epoch)}, cycle ${d.cycle}</span></p><p class="cap-s">Struck from the attestation epoch</p>`);
      };
      reduced ? strikeDate() : setTimeout(strikeDate, 320);
    } else { step("attest", "warn", "attested, but the standard fails"); cap("office", `<p class="cap-s">Not struck: the standard mark was not earned</p>`); }
  }
  if (!officeOk) cap("date", `<p class="cap-s">Not struck: no attestation epoch</p>`);

  $("#go").disabled = false; $("#go").textContent = "Assay";
  $("#cert").removeAttribute("aria-busy");
  const name = live ? live.name : rec.name;
  $("#c-name").textContent = name;
  const SUM = {
    ok: "Assayed and hallmarked. A public commit rebuilds these exact bytes.",
    warn: "Hallmarked with a qualified standard. The bytes match, with warnings noted below.",
    bad: "Failed assay. The claimed source did not rebuild these bytes.",
    withdrawn: "Hallmark withdrawn. The bytes on chain no longer match the recorded build.",
    none: "Unassayed. Nobody has shown which source builds these bytes.",
  };
  $("#c-sum").textContent = SUM[kind];
  stamp(kind);
  const body = kind === "none" ? bodyUnverified(hx, live)
    : kind === "withdrawn" ? bodyMismatch(hx, live, rec)
    : kind === "bad" ? bodyFailed(hx, live, rec, liveErr)
    : bodyVerified(hx, live, rec, liveErr, att);
  $("#c-body").innerHTML = body;
}

$("#lookup").addEventListener("submit", (ev) => { ev.preventDefault(); lookup($("#addr").value, { scroll: true }); });
document.querySelectorAll(".specimens [data-t], .selfcheck [data-t]").forEach((b) => b.addEventListener("click", (ev) => {
  ev.preventDefault();
  lookup(b.dataset.t, { scroll: true });
}));
out.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-copy]");
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copied"; } catch { b.textContent = "Select and copy"; }
  setTimeout(() => (b.textContent = "Copy"), 1500);
});
out.addEventListener("submit", (ev) => {
  if (ev.target.id !== "req") return;
  ev.preventDefault();
  const f = new FormData(ev.target), hx = ev.target.dataset.t;
  const q = new URLSearchParams({ template: "verify-request.yml", labels: "verify-request", title: `Verify template_${hx}`, address: `template_${hx}` });
  for (const k of ["repo", "commit", "workdir", "rustc", "remap"]) { const v = String(f.get(k) || "").trim(); if (v) q.set(k, v); }
  window.open(`https://github.com/${REPO}/issues/new?${q}`, "_blank", "noopener");
});

// ---------- home sections, fed by the same data the register uses ----------
async function homeData() {
  const reg = await loadRegistry();
  if (!reg) return;
  const third = Object.values(reg.records).filter((r) => !r.own)
    .sort((a, b) => (b.clean - a.clean) || (b.match - a.match) || a.name.localeCompare(b.name));
  const warn = reg.reproduced - reg.clean, bad = reg.attempted - reg.reproduced;
  whenVisible($("#t-rep"), () => { countUp($("#t-rep"), reg.reproduced); countUp($("#t-att"), reg.attempted); });
  $("#minis").innerHTML = third.map((r) => {
    const s = r.clean ? "struck" : r.match ? "qualified" : "cancelled";
    const label = `${r.name}: ${r.clean ? "hallmarked" : r.match ? "hallmarked, qualified" : "failed assay"}`;
    return `<a class="mini is-${s}" href="./?t=${r.template}" title="${esc(label)}" aria-label="${esc(label)}">${standardMark(s)}</a>`;
  }).join("");
  $("#legend").innerHTML = `<li><b>${reg.clean}</b> hallmarked</li><li><b>${warn}</b> <span class="brass">qualified</span>, with warnings</li><li><b>${bad}</b> <span class="red">failed</span>, diagnosed</li>`;
  // illustration only: the real WASM magic header, then hex taken from the recorded hashes
  const pool = Object.values(reg.records).map((r) => r.onchain_sha256 + r.built_sha256).join("");
  const bytes = ("0061736d01000000" + pool).match(/../g).slice(0, 300);
  $("#ingot").innerHTML = bytes.map((b, i) => (i < 8 ? `<b>${b}</b>` : b)).join(" ");

  // The four-marks strip: OneScan's own registry contract, struck as the strip scrolls into view.
  const own = reg.records[ONCHAIN.registryTemplate];
  const ds = $("#demo-strip");
  const ss = (k) => $(`[data-m="${k}"]`, ds);
  ds.setAttribute("data-strip", "");
  for (const k of ["maker", "standard", "office", "date"]) ss(k).innerHTML = blankMark(k);
  $("#self-strip .slot-m").innerHTML = blankMark("office");
  if (!own) return;
  const attP = fetchAttestations().catch(() => null);
  whenVisible(ds, async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));
    strike(ss("maker"), makerMark(own.author_public_key), "is-struck");
    await wait(380);
    strike(ss("standard"), standardMark(own.clean ? "struck" : "qualified"), "is-struck");
    const att = await attP;
    const a = att?.byTemplate.get(ONCHAIN.registryTemplate)?.[0];
    if (a && a.onchain_sha256 === own.onchain_sha256) {
      await wait(380);
      strike(ss("office"), officeMark(), "is-struck");
      await wait(380);
      strike(ss("date"), dateMark(a.epoch), "is-struck");
      $("#demo-cap").textContent = `Struck from live data: the marks of OneScan's own registry contract. Maker ${makerParts(own.author_public_key).initials}, fineness 32, office SourceRegistry, date letter ${dateParts(a.epoch).letter} (epoch ${a.epoch}).`;
    } else $("#demo-cap").textContent = "The registry could not be read live just now, so the office mark and date letter are left unstruck.";
  }, 0.5);
}
function officeData() {
  whenVisible($("#tx-count"), () => countUp($("#tx-count"), ONCHAIN.attestTxTemplates.size));
  fetchAttestations().then((att) => {
    whenVisible($("#att-count"), () => countUp($("#att-count"), att.byTemplate.size));
    if (att.byTemplate.has(ONCHAIN.registryTemplate)) whenVisible($("#self-strip"), () => strike($("#self-strip .slot-m"), officeMark(), "is-struck"));
  }, (e) => { $("#att-count").textContent = "unread"; $("#att-note").textContent = "Live read of the registry failed: " + String(e && e.message || e); });
}

reveal();
homeData();
officeData();
const t = new URLSearchParams(location.search).get("t");
if (t) lookup(t, { scroll: true });
