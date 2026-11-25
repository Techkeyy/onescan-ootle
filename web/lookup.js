import { reveal, countUp, bytesHTML, diffCount, reduced } from "./site.js";
import { SITE, REPO, ONCHAIN, explorerTx, esc, short, parseAddress, fetchTemplate, parseTdef, fetchAttestations } from "./lib.js";

const $ = (s) => document.querySelector(s);
const out = $("#result");
let registry = null;

async function loadRegistry() {
  if (!registry) registry = fetch("data/registry.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return registry;
}

const ghLink = (repo, commit) => {
  const name = (repo || "").replace("https://github.com/", "");
  return `<a href="${esc(repo)}/tree/${esc(commit)}">${esc(name)}</a> @ <a class="mono" href="${esc(repo)}/commit/${esc(commit)}">${esc((commit || "").slice(0, 10))}</a>`;
};

const MODE = {
  raw: "raw: the plain cargo/tari build output, unmodified",
  "walletd-optimized": "walletd-optimized: the build, then the wasm-opt pass that tari_walletd applies when publishing",
};

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

function copyBtn(text) { return `<button type="button" class="ghost" data-copy="${esc(text)}">Copy</button>`; }

function hashBlock(live, rec, liveErr) {
  const a = live ? live.sha256 : rec ? rec.onchain_sha256 : null;
  const b = rec ? rec.built_sha256 : null;
  const rows = [];
  if (live) rows.push(["On-chain, read live from the indexer and hashed in your browser", a]);
  else if (rec) rows.push(["On-chain, as recorded by the verifier run (live read unavailable)", a]);
  if (rec) rows.push([rec.match ? `Built from source (${rec.mode})` : "Closest build from source", b]);
  let eq = "";
  if (a && b) {
    const n = diffCount(a, b);
    eq = n === 0 ? `<span class="eq ok">equal, 32 of 32 bytes</span>` : `<span class="eq bad">different, ${n} of 32 bytes</span>`;
  }
  return `<div class="hashes">${rows.map(([k, v], i) => `<div class="hash"><div class="k"><span>${esc(k)}</span>${i === 1 ? eq : ""}</div>
    <div class="bytes" role="img" aria-label="sha256 ${esc(v)}">${bytesHTML(v, rows.length === 2 ? rows[1 - i][1] : null)}</div><div class="v">${esc(v)}</div></div>`).join("")}</div>
  ${liveErr ? `<p class="note">${esc(liveErr)}</p>` : ""}`;
}

function onchainFacts(hx, live) {
  if (!live) return "";
  return `<dt>Template</dt><dd class="mono">template_${esc(hx)}</dd>
    <dt>Name on chain</dt><dd>${esc(live.name)}</dd>
    <dt>Author public key</dt><dd class="mono">${esc(live.author)}</dd>
    <dt>Binary size</dt><dd>${live.size.toLocaleString()} bytes</dd>`;
}

function functionsBlock(live) {
  if (!live) return "";
  const t = parseTdef(live.binary);
  if (t.error) return `<div class="section"><h3>Functions</h3><p class="note">Could not list functions: ${esc(t.error)}.</p></div>`;
  const rows = t.functions.map((f) => `<tr><td><strong class="mono">${esc(f.name)}</strong><div class="sig">${esc(f.kind === "function" ? "" : f.kind + (f.args.length ? ", " : ""))}${f.args.map(([n, ty]) => esc(n) + ": " + esc(ty)).join(", ")} → ${esc(f.output)}</div></td>
    <td>${f.flags.map(([l, c]) => `<span class="flag ${c === "info" ? "info" : ""}">${esc(l)}</span>`).join("") || ""}</td></tr>`).join("");
  return `<div class="section"><h3>What the code exposes</h3>
    <table class="fns"><thead><tr><th>Function and signature</th><th>Flags</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="note">Decoded from the template's own <code>tari_tdef</code> ABI section in the on-chain bytes. Flags are pattern hints from argument types and names. The ABI does not say who may call each method; access rules are set at runtime and are not shown here.</p></div>`;
}

const NOT_AUDIT = `<p class="notaudit"><strong>Verified source is not an audit.</strong> A match proves which public commit these bytes were built from. It does not mean the code is safe.</p>`;

function badgeBlock(hx) {
  const md = `[![OneScan](https://img.shields.io/endpoint?url=${SITE}badge/${hx}.json)](${SITE}?t=${hx})`;
  return `<div class="section"><h3>Badge for the README</h3>
    <p><img alt="OneScan badge" height="20" src="https://img.shields.io/endpoint?url=${encodeURIComponent(SITE + "badge/" + hx + ".json")}"></p>
    <pre class="cmd">${esc(md)}${copyBtn(md)}</pre></div>`;
}

function warningsBlock(rec) {
  const w = rec.warnings || [];
  if (!w.length) return "";
  return `<div class="section"><h3>Warnings</h3><ul class="warns">${w.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <p class="note">The bytes still match, but these weaken what the match proves. Build scripts and network access during a build could fetch or decode the on-chain binary instead of compiling it.</p></div>`;
}

function isolationFact(rec) {
  const i = rec.isolation;
  if (!i) return "not recorded (older run)";
  return (i.network_isolated ? "no network during the build" : "network NOT isolated") + (i.note ? ` (${esc(i.note)})` : "");
}

// "Attested on-chain" row: read live from the SourceRegistry component; only the trusted verifier key counts,
// and only when the attested on-chain hash equals the hash of the bytes the indexer returns right now.
function attestedFact(hx, live, att) {
  if (!att) return "";
  if (att.error) return `<dt>Attested on-chain</dt><dd>Could not read the registry component live: ${esc(att.error)}</dd>`;
  const a = att.byTemplate.get(hx)?.[0];
  if (!a) return `<dt>Attested on-chain</dt><dd>No attestation by the trusted verifier in registry <span class="mono">${esc(short(ONCHAIN.registry, 22))}</span> yet.</dd>`;
  if (!live) return `<dt>Attested on-chain</dt><dd>An attestation exists, but the live template bytes could not be read, so its hash was not compared. Not counted.</dd>`;
  if (a.onchain_sha256 !== live.sha256) return `<dt>Attested on-chain</dt><dd><span class="eq bad">hash differs</span>: the attestation names <span class="mono">${esc(short(a.onchain_sha256, 16))}</span>, the live bytes hash differently. Not counted.</dd>`;
  const tx = ONCHAIN.attestTxTemplates.has(hx) ? `<a class="mono" href="${explorerTx(ONCHAIN.attestTx)}">tx ${esc(short(ONCHAIN.attestTx, 12))}</a>` : "transaction not recorded here";
  return `<dt>Attested on-chain</dt><dd><span class="eq ok">yes</span>, read live from registry <span class="mono" title="${esc(ONCHAIN.registry)}">${esc(short(ONCHAIN.registry, 22))}</span> (epoch ${esc(a.epoch)}), ${tx}; verifier <span class="mono" title="${esc(a.verifier)}">${esc(short(a.verifier, 16))}</span> <span class="flag info">trusted</span>, attested hash equals the live hash.</dd>`;
}

function verified(hx, live, rec, liveErr, att) {
  const recorded = !live;
  const clean = rec.clean;
  return `<div class="status ${clean ? "s-ok" : "s-warn"}"><div class="head"><span class="badge">${clean ? "VERIFIED" : "VERIFIED (WITH WARNINGS)"}</span><div>
      <div class="t">${esc(rec.name)}</div>
      <p>${recorded ? "The verifier run matched the on-chain bytes. A live re-check could not run in this browser, so the hash below is the recorded one." : "The bytes on chain right now are byte-identical to a reproducible build of this public commit."}</p></div></div>
    <div class="body">
      <div class="section">${hashBlock(live, rec, liveErr)}</div>
      <div class="section"><dl class="facts">
        <dt>Source</dt><dd>${ghLink(rec.repo, rec.commit)}</dd>
        <dt>Toolchain</dt><dd>${esc(rec.toolchain?.rustc || "")}${rec.toolchain?.tari_cli ? ", " + esc(rec.toolchain.tari_cli) : ""} on ${esc(rec.runner_os || "Linux")}</dd>
        <dt>Build mode</dt><dd>${esc(MODE[rec.mode] || rec.mode)}</dd>
        <dt>Verifier run</dt><dd><a href="${esc(rec.run_url)}">GitHub Actions run ${esc(rec.run_url.split("/").pop())}</a>, ${esc(rec.verified_at)}</dd>
        <dt>Build isolation</dt><dd>${isolationFact(rec)}</dd>
        ${attestedFact(hx, live, att)}
        ${onchainFacts(hx, live)}
      </dl></div>
      ${warningsBlock(rec)}
      <div class="section"><h3>Re-run it yourself</h3>
        <pre class="cmd">${esc(rerunCmd(rec))}${copyBtn(rerunCmd(rec))}</pre>
        <p class="note">Runs the same public workflow in your fork of <a href="https://github.com/${REPO}">onescan-ootle</a>; the run fetches the template from the indexer and compares hashes itself.</p></div>
      ${functionsBlock(live)}
      ${badgeBlock(hx)}
      ${NOT_AUDIT}
    </div></div>`;
}

function mismatch(hx, live, rec) {
  return `<div class="status s-bad"><div class="head"><span class="badge">MISMATCH</span><div>
      <div class="t">${esc(rec.name)}</div>
      <p>A verifier run matched this template, but the bytes the indexer returns now hash differently. Treat the source as unverified.</p></div></div>
    <div class="body"><div class="section">${hashBlock(live, rec)}</div><div class="section"><dl class="facts">${onchainFacts(hx, live)}</dl></div>${NOT_AUDIT}</div></div>`;
}

function notReproduced(hx, live, rec, liveErr) {
  return `<div class="status s-warn"><div class="head"><span class="badge">NOT REPRODUCED</span><div>
      <div class="t">${esc(rec.name)}</div>
      <p>OneScan rebuilt the claimed source and did not get these on-chain bytes. That does not mean the code is malicious; it means nobody has yet shown which source builds them.</p></div></div>
    <div class="body">
      <div class="section">${hashBlock(live, rec, liveErr)}</div>
      <div class="section"><dl class="facts">
        <dt>Cause</dt><dd>${esc(rec.cause)}</dd>
        <dt>Source tried</dt><dd>${ghLink(rec.repo, rec.commit)}</dd>
        <dt>Toolchain tried</dt><dd>${esc(rec.toolchain?.rustc || "")}${rec.toolchain?.tari_cli ? ", " + esc(rec.toolchain.tari_cli) : ""}</dd>
        <dt>Verifier run</dt><dd><a href="${esc(rec.run_url)}">GitHub Actions run ${esc(rec.run_url.split("/").pop())}</a>, ${esc(rec.verified_at)}</dd>
        ${onchainFacts(hx, live)}
      </dl></div>
      ${functionsBlock(live)}
      <div class="section"><h3>Know the right commit?</h3>${requestForm(hx)}</div>
      ${badgeBlock(hx)}
      ${NOT_AUDIT}
    </div></div>`;
}

function requestForm(hx) {
  return `<form class="req" id="req" data-t="${hx}">
    <label>Source repository<input type="url" name="repo" required placeholder="https://github.com/owner/repo" pattern="https://github\\.com/[^/]+/[^/]+/?"></label>
    <div class="row"><label>Commit<input type="text" name="commit" required placeholder="a1b2c3d" pattern="[0-9a-fA-F]{7,40}"></label>
    <label>Crate sub-directory (optional)<input type="text" name="workdir" placeholder="contracts/my-template"></label></div>
    <div class="row"><label>Rust toolchain (optional)<input type="text" name="rustc" placeholder="1.98.1"></label>
    <label>CARGO_HOME remap (optional)<input type="text" name="remap" placeholder="/home/you/.cargo"></label></div>
    <div><button type="submit">Open verification request on GitHub</button></div>
    <p class="note">Opens a prefilled issue in ${REPO}. Submitting it starts a public GitHub Actions run that rebuilds the commit and posts the result on the issue. You need a GitHub account.</p>
  </form>`;
}

function unverified(hx, live) {
  return `<div class="status s-none"><div class="head"><span class="badge">UNVERIFIED</span><div>
      <div class="t">${esc(live.name)}</div>
      <p>This template is live on Ootle mainnet, but nobody has shown which source builds these bytes.</p></div></div>
    <div class="body">
      <div class="section"><div class="hashes"><div class="hash"><div class="k"><span>On-chain, read live from the indexer and hashed in your browser</span></div><div class="v">${esc(live.sha256)}</div></div></div></div>
      <div class="section"><dl class="facts">${onchainFacts(hx, live)}</dl></div>
      ${functionsBlock(live)}
      <div class="section"><h3>Request verification</h3>${requestForm(hx)}</div>
      ${NOT_AUDIT}
    </div></div>`;
}

function error(title, msg) { return `<div class="err" role="alert"><strong>${esc(title)}</strong><p style="margin:6px 0 0">${msg}</p></div>`; }

// ---------- the scanner instrument: each step changes state only when its real request completes ----------
const pipe = $("#pipe");
const stepEl = (n) => pipe.querySelector(`[data-step="${n}"]`);
function step(n, s, detail) {
  const li = stepEl(n);
  li.dataset.s = s;
  if (detail != null) { const d = li.querySelector(".step-d"); d.textContent = detail; d.title = detail; }
}
function verdict(v, text) { const el = $("#pipe-verdict"); el.dataset.v = v; el.textContent = text; }
const prints = { a: null, b: null };
function setPrints(a, b, la = "", lb = "") {
  if (a !== undefined) { prints.a = a; $("#pa-l").textContent = la; }
  if (b !== undefined) { prints.b = b; $("#pb-l").textContent = lb; }
  const pa = $("#pa"), pb = $("#pb"), pm = $("#pm");
  pa.innerHTML = bytesHTML(prints.a, prints.b); pa.classList.toggle("empty", !prints.a);
  pb.innerHTML = bytesHTML(prints.b, prints.a); pb.classList.toggle("empty", !prints.b);
  pa.setAttribute("role", "img"); pb.setAttribute("role", "img");
  pa.setAttribute("aria-label", prints.a ? `on-chain sha256 ${prints.a}` : "on-chain sha256 not available");
  pb.setAttribute("aria-label", prints.b ? `rebuilt sha256 ${prints.b}` : "rebuilt sha256 not available");
  pm.className = "match-line";
  if (prints.a && prints.b) {
    const n = diffCount(prints.a, prints.b);
    pm.classList.add(n ? "bad" : "ok");
    pm.textContent = n ? `≠ ${n} of 32 bytes differ` : "= byte-for-byte, 32 of 32";
  } else pm.textContent = prints.a ? "no rebuild to compare" : prints.b ? "awaiting on-chain bytes" : "awaiting bytes";
}
function pipeLive(hx) {
  pipe.dataset.mode = "live";
  pipe.dataset.busy = "";
  $("#pipe-mode").textContent = hx ? `Live scan · template_${hx.slice(0, 10)}…` : "Live scan";
  verdict("run", "scanning");
  for (const li of pipe.querySelectorAll("[data-step]")) step(li.dataset.step, "", "waiting");
  setPrints(null, null);
  $("#pipe-cap").textContent = "Each step above reflects a request your browser made just now; it lights up only when that request returns.";
}
function pipeDone() { delete pipe.dataset.busy; }

async function idleExample() {
  const reg = await loadRegistry();
  const r = reg?.records?.[ONCHAIN.registryTemplate];
  if (r && pipe.dataset.mode === "idle") setPrints(r.onchain_sha256, r.built_sha256, "recorded", r.mode);
}

let runId = 0;
async function lookup(raw, opts = {}) {
  const hx = parseAddress(raw);
  const id = ++runId;
  const mine = () => id === runId;
  if (opts.scroll) pipe.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  if (!hx) {
    pipeLive(null);
    step("bytes", "fail", "not a template address");
    for (const n of ["hash", "rebuild", "compare", "attest"]) step(n, "skip", "not run");
    verdict("bad", "invalid");
    pipeDone();
    out.innerHTML = error("That is not a template address.", "Expected <code>template_</code> followed by 64 hex characters, or just the 64 hex characters.");
    return;
  }
  history.replaceState(null, "", `?t=${hx}`);
  $("#addr").value = `template_${hx}`;
  $("#go").disabled = true;
  pipeLive(hx);
  out.innerHTML = `<p class="loading">Reading template_${short(hx)} from the indexer and hashing it…</p>`;
  step("bytes", "run", "indexer request…");
  step("rebuild", "run", "loading records…");
  step("attest", "run", "reading registry…");

  let rec;
  const regP = loadRegistry().then((reg) => {
    rec = reg?.records?.[hx];
    if (!mine()) return reg;
    if (!rec) step("rebuild", "skip", reg ? "no rebuild on record" : "records unavailable");
    else {
      const run = (rec.run_url || "").split("/").pop();
      step("rebuild", rec.match && rec.clean ? "ok" : "warn",
        rec.match ? `run ${run} · ${rec.mode}${rec.clean ? "" : " · warnings"}` : `run ${run} · closest build`);
      setPrints(undefined, rec.built_sha256, "", rec.match ? rec.mode : "closest build");
    }
    return reg;
  });
  const liveP = fetchTemplate(hx, (k, info) => {
    if (!mine()) return;
    step("bytes", "ok", `${info.size.toLocaleString()} bytes · epoch ${info.epoch}`);
    step("hash", "run", "hashing…");
  }).then((v) => {
    if (mine()) { step("hash", "ok", `${v.sha256.slice(0, 12)}…`); setPrints(v.sha256, undefined, "live, hashed here"); }
    return { v };
  }, (e) => {
    if (mine()) {
      step("bytes", "fail", e.kind === "notfound" ? "404 · no template here" : e.kind === "shape" ? "not a template substate" : "indexer unreachable");
      step("hash", "skip", "no bytes to hash");
    }
    return { e };
  });
  const attP = fetchAttestations().catch((e) => ({ error: String(e && e.message || e) }));
  Promise.all([attP, liveP]).then(([att, lr]) => {
    if (!mine()) return;
    if (att.error) return step("attest", "fail", "registry unreadable");
    const a = att.byTemplate.get(hx)?.[0];
    if (!a) step("attest", "skip", "no attestation");
    else if (!lr.v) step("attest", "warn", "exists · not compared");
    else if (a.onchain_sha256 !== lr.v.sha256) step("attest", "fail", "attested hash differs");
    else step("attest", "ok", `attested · epoch ${a.epoch}`);
  });

  const [, liveRes, att] = await Promise.all([regP, liveP, attP]);
  if (!mine()) return;
  $("#go").disabled = false;
  pipeDone();
  const live = liveRes.v;
  const e = liveRes.e;
  // compare step: needs both sides
  if (live && rec) {
    const n = diffCount(live.sha256, rec.built_sha256);
    step("compare", n ? "fail" : "ok", n ? `${n} / 32 bytes differ` : "32 / 32 bytes equal");
  } else if (!live && rec) {
    setPrints(rec.onchain_sha256, undefined, "recorded (live read failed)");
    step("compare", "warn", rec.match ? "recorded hashes equal" : "recorded hashes differ");
  } else step("compare", "skip", live ? "nothing to compare" : "no bytes");

  if (e && e.kind === "notfound") {
    verdict("bad", "not found");
    out.innerHTML = error("No template at this address on Ootle mainnet.", `The indexer returned 404 for <code>template_${esc(hx)}</code>. Check the address; component and resource addresses are not templates.`);
    return;
  }
  let liveErr = "";
  if (e) {
    liveErr = `Live check unavailable: ${e.message || e.kind}. ${rec ? "Showing the hashes recorded by the verifier run instead." : ""}`;
    if (!rec) { verdict("bad", "error"); out.innerHTML = error("Could not read the template from the indexer.", esc(liveErr) + " No verification record exists for this address either, so OneScan cannot say anything about it right now."); return; }
  }
  if (!rec) { verdict("", "unverified"); out.innerHTML = unverified(hx, live); }
  else if (rec.match && live && live.sha256 !== rec.built_sha256) { verdict("bad", "mismatch"); out.innerHTML = mismatch(hx, live, rec); }
  else if (rec.match) { verdict(rec.clean ? "ok" : "warn", rec.clean ? "verified" : "verified · warnings"); out.innerHTML = verified(hx, live, rec, liveErr, att); }
  else { verdict("warn", "not reproduced"); out.innerHTML = notReproduced(hx, live, rec, liveErr); }
  $("#pipe-cap").textContent = "Scan complete. Full evidence below.";
}

$("#lookup").addEventListener("submit", (ev) => { ev.preventDefault(); lookup($("#addr").value, { scroll: true }); });
document.querySelectorAll(".try [data-t], .selfcheck [data-t]").forEach((b) => b.addEventListener("click", (ev) => {
  ev.preventDefault();
  const self = !!b.closest(".selfcheck");
  if (self) $("#top").scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  lookup(b.dataset.t, { scroll: !self });
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

// ---------- home sections, fed by the same data the board uses ----------
function whenVisible(el, fn) {
  if (!el) return;
  if (!("IntersectionObserver" in window)) return fn();
  const io = new IntersectionObserver((en) => { if (en.some((x) => x.isIntersecting)) { io.disconnect(); fn(); } }, { threshold: 0.3 });
  io.observe(el);
}
async function homeData() {
  const reg = await loadRegistry();
  if (!reg) return;
  const third = Object.values(reg.records).filter((r) => !r.own)
    .sort((a, b) => (b.clean - a.clean) || (b.match - a.match) || a.name.localeCompare(b.name));
  const warn = reg.reproduced - reg.clean, bad = reg.attempted - reg.reproduced;
  whenVisible($("#t-rep"), () => { countUp($("#t-rep"), reg.reproduced); countUp($("#t-att"), reg.attempted); });
  const strip = $("#strip");
  strip.style.setProperty("--n", third.length);
  strip.innerHTML = third.map((r) => {
    const s = r.clean ? "ok" : r.match ? "warn" : "bad";
    const label = `${r.name}: ${r.clean ? "reproduced" : r.match ? "reproduced, with warnings" : "not reproduced"}`;
    return `<a class="${s}" href="./?t=${r.template}" title="${esc(label)}" aria-label="${esc(label)}"></a>`;
  }).join("");
  $("#legend").innerHTML = `<li><i class="ok"></i><b>${reg.clean}</b>reproduced clean</li><li><i class="warn"></i><b>${warn}</b>with warnings</li><li><i class="bad"></i><b>${bad}</b>not reproduced, diagnosed</li>`;
  // illustration only: the real WASM magic header, then hex taken from the recorded hashes
  const pool = Object.values(reg.records).map((r) => r.onchain_sha256 + r.built_sha256).join("");
  const bytes = ("0061736d01000000" + pool).match(/../g).slice(0, 360);
  $("#opaque").insertAdjacentHTML("afterbegin", bytes.map((b, i) => (i < 8 ? `<b>${b}</b>` : b)).join(" "));
}
function proofData() {
  whenVisible($("#tx-count"), () => countUp($("#tx-count"), ONCHAIN.attestTxTemplates.size));
  fetchAttestations().then((att) => {
    whenVisible($("#att-count"), () => countUp($("#att-count"), att.byTemplate.size));
  }, (e) => { $("#att-note").textContent = "Live read of the registry failed: " + String(e && e.message || e); });
}

reveal();
homeData();
proofData();
const t = new URLSearchParams(location.search).get("t");
if (t) lookup(t);
else idleExample();
