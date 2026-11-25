import { reduced, countUp, diffCount, hashDiff, seal, burst, stamp, notice, copyBtn, wireCopy, ledgerRows, coverage } from "./site.js";
import { SITE, REPO, ONCHAIN, explorerTx, esc, short, parseAddress, fetchTemplate, parseTdef, fetchAttestations } from "./lib.js";

const $ = (s, r = document) => r.querySelector(s);
const out = $("#result");
const intro = $("#check-intro");
const isCheck = document.documentElement.dataset.view === "check";
let registry = null;

function loadRegistry() {
  if (!registry) registry = fetch("data/registry.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return registry;
}

const repoName = (repo) => (repo || "").replace("https://github.com/", "");
const ghLink = (repo, commit) =>
  `<a class="link" href="${esc(repo)}/tree/${esc(commit)}">${esc(repoName(repo))}</a> at <a class="link mono" href="${esc(repo)}/commit/${esc(commit)}">${esc((commit || "").slice(0, 10))}</a>`;
const runNo = (rec) => esc((rec.run_url || "").split("/").pop());
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

// ---------- the check workspace: the real stages, in the order they run ----------
const STAGES = [
  ["bytes", "Reading the template from the indexer"],
  ["hash", "Hashing the bytes in your browser"],
  ["rebuild", "Finding the rebuild record"],
  ["compare", "Comparing the two hashes"],
  ["attest", "Reading the on-chain attestation"],
];
const WORD = { "": "Waiting", run: "Working", ok: "Done", warn: "Done, with a caveat", fail: "Failed", skip: "Not run" };
const ICON = {
  ok: `<svg viewBox="0 0 14 14" fill="none"><path d="M3 7.5l2.6 2.6L11 4.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  fail: `<svg viewBox="0 0 14 14" fill="none"><path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  warn: `<svg viewBox="0 0 14 14" fill="none"><path d="M7 3.2v4.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="7" cy="10.6" r="1.2" fill="currentColor"/></svg>`,
  skip: `<svg viewBox="0 0 14 14" fill="none"><path d="M4 7h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
};

function shell(hx, rec) {
  return `<div id="r-head"><h1 class="h-page">Checking the template against the chain</h1>
      <p class="mt-2 muted">Every step below is real and updates the moment it returns.</p></div>
    <div class="res-grid">
      <section class="print pad pad-lg stages" aria-labelledby="stages-title">
        <div class="stages-head"><h2 id="stages-title" class="h-card-lg">What is happening</h2><p class="mono small muted" id="elapsed">Running</p></div>
        <div class="meter meter-run" role="progressbar" aria-label="Steps finished" aria-valuemin="0" aria-valuemax="${STAGES.length}" aria-valuenow="0" id="r-meter"><i style="width:4%"></i></div>
        <ol>${STAGES.map(([k, label], i) => `<li class="stage" data-step="${k}" data-s=""><div class="rail"><span class="node" aria-hidden="true">${i + 1}</span><span class="line"></span></div>
          <div class="body"><div class="top"><span class="lbl">${label}</span><span class="word">Waiting</span></div><p class="det"></p></div></li>`).join("")}</ol>
      </section>
      <section aria-labelledby="in-title">
        <h2 id="in-title" class="h-card-lg">What was checked</h2>
        <dl class="fields fields-tight mt-3">
          <div><dt>Template</dt><dd><span class="hash"><code title="template_${esc(hx)}">template_${esc(hx.slice(0, 10))}...${esc(hx.slice(-6))}</code>${copyBtn("template_" + hx)}</span></dd></div>
          <div><dt>Name</dt><dd id="in-name" class="muted">Reading</dd></div>
          <div><dt>Network</dt><dd>Ootle mainnet</dd></div>
          <div><dt>Source</dt><dd>${rec ? ghLink(rec.repo, rec.commit) : `<span class="muted">None on record</span>`}</dd></div>
        </dl>
      </section>
    </div>
    <div id="r-body"></div>`;
}

function step(n, s, detail) {
  const li = $(`#result [data-step="${n}"]`);
  if (!li) return;
  li.dataset.s = s;
  const i = STAGES.findIndex(([k]) => k === n);
  $(".node", li).innerHTML = ICON[s] || String(i + 1);
  $(".word", li).textContent = WORD[s];
  if (detail != null) $(".det", li).textContent = detail;
  const done = [...document.querySelectorAll("#result [data-step]")].filter((x) => ["ok", "warn", "fail", "skip"].includes(x.dataset.s)).length;
  const m = $("#r-meter");
  if (m) { m.setAttribute("aria-valuenow", String(done)); $("i", m).style.width = `${Math.max(4, (done / STAGES.length) * 100)}%`; }
}

// ---------- result sections ----------
const section = (title, html) => `<section class="rsec"><h2>${title}</h2><div>${html}</div></section>`;
const NOT_AUDIT = `<div class="rsec">${notice("warn", "Verified source is not an audit", "<p>A match proves which public commit built these bytes. It does not mean the code is safe. Read the source.</p>")}</div>`;

function onchainFacts(live, rec) {
  const author = live ? live.author : rec?.author_public_key;
  return `${live ? `<div><dt>Name on chain</dt><dd>${esc(live.name)}</dd></div>` : ""}
    ${author ? `<div><dt>Author public key</dt><dd class="mono">${esc(author)}${live ? "" : " (recorded)"}</dd></div>` : ""}
    ${live ? `<div><dt>Published at epoch</dt><dd>${esc(live.epoch)}</dd></div><div><dt>Binary size</dt><dd>${live.size.toLocaleString()} bytes</dd></div>` : ""}`;
}

function hashFacts(a, b, la, lb) {
  const rows = [];
  if (a) rows.push(`<div><dt>${esc(la)}</dt><dd class="bytes">${hashDiff(a, b)}</dd></div>`);
  if (b) rows.push(`<div><dt>${esc(lb)}</dt><dd class="bytes">${hashDiff(b, a)}</dd></div>`);
  if (a && b) {
    const n = diffCount(a, b);
    rows.push(`<div><dt>Comparison</dt><dd class="${n ? "bad" : "ok"}" style="font-weight:600">${n ? `${n} of 32 bytes differ` : "32 of 32 bytes equal"}</dd></div>`);
  }
  return rows.join("");
}

function functionsBlock(live) {
  if (!live) return "";
  const t = parseTdef(live.binary);
  if (t.error) return section("What it can do", `<p class="muted">Could not list the methods: ${esc(t.error)}.</p>`);
  const moves = t.functions.filter((f) => f.flags.some(([l]) => /tokens/.test(l))).length;
  const rows = t.functions.map((f) => `<tr><td><span class="fn">${esc(f.name)}</span><span class="sig">${esc(f.kind === "function" ? "" : f.kind + (f.args.length ? ", " : ""))}${f.args.map(([n, ty]) => esc(n) + ": " + esc(ty)).join(", ")} returns ${esc(f.output)}</span></td>
    <td>${f.flags.map(([l, c]) => `<span class="chip ${c === "info" ? "info" : ""}">${esc(l)}</span>`).join("")}</td></tr>`).join("");
  return section("What it can do", `<p>${t.functions.length} methods. ${moves} of them move funds: they take or release tokens.</p>
    <div class="fns-wrap mt-3"><table class="fns"><thead><tr><th scope="col">Method and signature</th><th scope="col">Flags</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="mt-3 small muted">Decoded from the template's own <code>tari_tdef</code> ABI section in the on-chain bytes. Flags are hints from argument types and names. The ABI does not say who may call each method: access rules are set at runtime and are not shown here.</p>`);
}

function badgeBlock(hx) {
  const url = `${SITE}?t=${hx}`;
  const md = `[![OneScan](https://img.shields.io/endpoint?url=${SITE}badge/${hx}.json)](${url})`;
  return section("Share it", `<p style="font-weight:500">Link to this check</p>
    <div class="hash mt-1"><code title="${esc(url)}">${esc(url)}</code>${copyBtn(url, "Copy link")}</div>
    <p class="mt-4" style="font-weight:500">README badge</p>
    <img class="badge-img mt-2" alt="OneScan badge for this template" height="20" src="https://img.shields.io/endpoint?url=${encodeURIComponent(SITE + "badge/" + hx + ".json")}">
    <div class="cmd mt-2"><pre><code>${esc(md)}</code></pre>${copyBtn(md, "Copy markdown")}</div>`);
}

function rerunBlock(rec) {
  const cmd = rerunCmd(rec);
  return section("Check it yourself", `<div class="cmd"><pre><code>${esc(cmd)}</code></pre>${copyBtn(cmd)}</div>
    <p class="mt-3 small muted">Runs the same public workflow in your fork of <a class="link" href="https://github.com/${REPO}">onescan-ootle</a>. The run fetches the template from the indexer and compares the hashes itself, so you do not have to trust this page.</p>`);
}

function isolationFact(rec) {
  const i = rec.isolation;
  if (!i) return "Not recorded (older run)";
  return (i.network_isolated ? "No network during the build" : "Network not isolated") + (i.note ? ` (${esc(i.note)})` : "");
}

// The registry read, judged the same way the stage was.
function attestBlock(hx, live, att, kind) {
  let n;
  const reg = `<span class="mono" title="${esc(ONCHAIN.registry)}">${esc(short(ONCHAIN.registry, 22))}</span>`;
  if (att.error) n = notice("warn", "Could not read the registry", `<p>${esc(att.error)}. Nothing was decided from it.</p>`);
  else {
    const a = att.byTemplate.get(hx)?.[0];
    if (!a) n = notice("neutral", "Not recorded on-chain", `<p>No attestation by the trusted key in registry ${reg} for this template.</p>`);
    else if (!live) n = notice("warn", "Recorded, but not compared", "<p>An attestation exists, but the live bytes could not be read, so its hash was not compared. Not counted.</p>");
    else if (a.onchain_sha256 !== live.sha256) n = notice("bad", "The attested hash differs", `<p>The attestation names <span class="mono">${esc(short(a.onchain_sha256, 16))}</span>, and the live bytes hash differently. Not counted.</p>`);
    else if (kind !== "ok" && kind !== "warn") n = notice("warn", "Recorded, but not counted", "<p>An attestation exists, but the bytes do not match a public build, so OneScan does not count it.</p>");
    else {
      const tx = ONCHAIN.attestTxTemplates.has(hx) ? `in <a class="link mono" href="${explorerTx(ONCHAIN.attestTx)}">tx ${esc(short(ONCHAIN.attestTx, 12))}</a>` : "(transaction not recorded here)";
      n = notice("ok", "Recorded on-chain", `<p>Read live from registry ${reg} at epoch ${esc(a.epoch)}, ${tx}.</p>
        <p>Signed by the trusted key <span class="mono" title="${esc(a.verifier)}">${esc(short(a.verifier, 16))}</span>. The attested hash equals the live hash.</p>`);
    }
  }
  return section("On-chain record", `${n}<p class="mt-3">An attestation means OneScan's verifier key stated that this source builds these bytes. It is a statement by OneScan, not independent proof. You do not have to trust it, because anyone can repeat the rebuild.</p>`);
}

function requestForm(hx) {
  return `<form class="req" id="req" data-t="${hx}">
    <label>Source repository<input class="input" type="url" name="repo" required placeholder="https://github.com/owner/repo" pattern="https://github\\.com/[^/]+/[^/]+/?"></label>
    <div class="two"><label>Commit<input class="input mono" type="text" name="commit" required placeholder="a1b2c3d" pattern="[0-9a-fA-F]{7,40}"></label>
    <label>Crate sub-directory (optional)<input class="input mono" type="text" name="workdir" placeholder="contracts/my-template"></label></div>
    <div class="two"><label>Rust toolchain (optional)<input class="input mono" type="text" name="rustc" placeholder="1.98.1"></label>
    <label>CARGO_HOME remap (optional)<input class="input mono" type="text" name="remap" placeholder="/home/you/.cargo"></label></div>
    <div><button type="submit" class="btn btn-primary">Request a check on GitHub</button></div>
    <p class="small muted">Opens a prefilled issue in ${REPO}. Submitting it starts a public GitHub Actions run that rebuilds the commit and posts the result on the issue. You need a GitHub account.</p>
  </form>`;
}

function bodyVerified(hx, live, rec, liveErr, att, kind) {
  const w = rec.warnings || [];
  const a = live ? live.sha256 : rec.onchain_sha256;
  return `${w.length ? `<div class="rsec">${notice("warn", "Built with warnings", `<ul>${w.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><p>The bytes still match, but these weaken what the match proves. Build scripts and network access during a build could fetch or decode the on-chain binary instead of compiling it.</p>`)}</div>` : ""}
    ${liveErr ? `<div class="rsec">${notice("warn", "Live check unavailable", `<p>${esc(liveErr)}</p>`)}</div>` : ""}
    ${section("What was proven", `<dl class="fields">
      <div><dt>Source</dt><dd>${ghLink(rec.repo, rec.commit)}</dd></div>
      <div><dt>Toolchain</dt><dd>${esc(rec.toolchain?.rustc || "")}${rec.toolchain?.tari_cli ? ", " + esc(rec.toolchain.tari_cli) : ""} on ${esc(rec.runner_os || "Linux")}</dd></div>
      <div><dt>Build mode</dt><dd>${esc(MODE[rec.mode] || rec.mode)}</dd></div>
      <div><dt>Verifier run</dt><dd><a class="link" href="${esc(rec.run_url)}">GitHub Actions run ${runNo(rec)}</a>, ${esc(rec.verified_at)}</dd></div>
      <div><dt>Build isolation</dt><dd>${isolationFact(rec)}</dd></div>
      ${hashFacts(a, rec.built_sha256, live ? "On chain, hashed here" : "On chain, as recorded", `Built from source (${rec.mode})`)}
      ${onchainFacts(live, rec)}</dl>`)}
    ${attestBlock(hx, live, att, kind)}${functionsBlock(live)}${rerunBlock(rec)}${badgeBlock(hx)}${NOT_AUDIT}`;
}

function bodyFailed(hx, live, rec, liveErr, att, kind) {
  const a = live ? live.sha256 : rec.onchain_sha256;
  return `<p class="mt-4" style="max-width:42rem">This is not an accusation. It does not mean the code is malicious. It means nobody has yet shown which source builds these bytes, so if you know the commit it was published from, request a check of that one.</p>
    ${liveErr ? `<div class="rsec">${notice("warn", "Live check unavailable", `<p>${esc(liveErr)}</p>`)}</div>` : ""}
    ${section("What OneScan compared", `<dl class="fields">
      <div><dt>Diagnosis</dt><dd>${esc(rec.cause)}</dd></div>
      <div><dt>Source tried</dt><dd>${ghLink(rec.repo, rec.commit)}</dd></div>
      <div><dt>Toolchain tried</dt><dd>${esc(rec.toolchain?.rustc || "")}${rec.toolchain?.tari_cli ? ", " + esc(rec.toolchain.tari_cli) : ""}</dd></div>
      ${rec.sizes && rec.sizes[0] ? `<div><dt>Sizes</dt><dd>${Number(rec.sizes[0]).toLocaleString()} bytes on chain, ${Number(rec.sizes[1]).toLocaleString()} bytes in the closest build</dd></div>` : ""}
      <div><dt>Verifier run</dt><dd><a class="link" href="${esc(rec.run_url)}">GitHub Actions run ${runNo(rec)}</a>, ${esc(rec.verified_at)}</dd></div>
      ${hashFacts(a, rec.built_sha256, live ? "On chain, hashed here" : "On chain, as recorded", "Closest build from source")}
      ${onchainFacts(live, rec)}</dl>`)}
    ${attestBlock(hx, live, att, kind)}${functionsBlock(live)}
    ${section("Know the right commit?", requestForm(hx))}
    ${badgeBlock(hx)}${NOT_AUDIT}`;
}

function bodyMismatch(hx, live, rec, att, kind) {
  return `${section("What was on record", `<dl class="fields"><div><dt>Source on record</dt><dd>${ghLink(rec.repo, rec.commit)}</dd></div>
      ${hashFacts(live?.sha256, rec.onchain_sha256, "On chain now, hashed here", "On chain when verified")}${onchainFacts(live, rec)}</dl>`)}
    ${attestBlock(hx, live, att, kind)}${NOT_AUDIT}`;
}

function bodyUnverified(hx, live, att, kind) {
  return `${section("What is on chain", `<dl class="fields">${hashFacts(live.sha256, null, "On chain, hashed here")}${onchainFacts(live)}</dl>`)}
    ${attestBlock(hx, live, att, kind)}${functionsBlock(live)}
    ${section("Request a check", requestForm(hx))}${NOT_AUDIT}`;
}

const VERDICT = {
  ok: { tone: "ok", kicker: "Verdict", title: "Verified" },
  warn: { tone: "warn", kicker: "Verdict", title: "Verified, with warnings" },
  bad: { tone: "neutral", kicker: "Verdict", title: "Not reproduced" },
  none: { tone: "neutral", kicker: "Verdict", title: "Unverified" },
  withdrawn: { tone: "bad", kicker: "Previously verified", title: "Mismatch" },
};
function verdictBody(kind, live, rec) {
  switch (kind) {
    case "ok": return live ? "<p>The bytes running on Ootle mainnet are identical to a reproducible build of this public commit: 32 of 32 sha256 bytes.</p>"
      : "<p>The verifier run matched the on-chain bytes. A live re-check could not run in this browser, so this shows the recorded hashes.</p>";
    case "warn": return "<p>The bytes match a build of this public commit, but the build raised warnings that weaken what the match proves. They are listed below.</p>";
    case "bad": return `<p>OneScan rebuilt the claimed source and did not get these bytes. Diagnosis: ${esc(rec.cause)}.</p>`;
    case "none": return "<p>This template is live on Ootle mainnet, but nobody has shown which source builds these bytes.</p>";
    case "withdrawn": return "<p>A verifier run matched this template, but the bytes the indexer returns now hash differently. Treat the source as unverified.</p>";
  }
}

function failHead(title, body) {
  return `<p class="fail-kick">The check could not finish</p><h1 class="fail-title">${esc(title)}</h1>
    <p class="mt-3" style="max-width:42rem">${body}</p><p class="mt-2 muted">This is not a verdict on the template. It means no comparison was made.</p>`;
}

// ---------- the check ----------
let runId = 0, timer = 0;
function showInvalid(raw) {
  const err = $("#addr-err"), addr = $("#addr");
  intro.hidden = false;
  out.innerHTML = "";
  addr.value = String(raw || "");
  addr.setAttribute("aria-invalid", "true");
  addr.setAttribute("aria-describedby", "addr-err addr-help");
  err.innerHTML = "That is not a template address. Expected <code>template_</code> followed by 64 hex characters, or just the 64 hex characters.";
  err.hidden = false;
  addr.focus({ preventScroll: true });
}

async function lookup(raw) {
  const hx = parseAddress(raw);
  const id = ++runId;
  const mine = () => id === runId;
  clearInterval(timer);
  if (!hx) { history.replaceState(null, "", "?check"); showInvalid(raw); return; }
  $("#addr-err").hidden = true;
  $("#addr").removeAttribute("aria-invalid");
  $("#addr").setAttribute("aria-describedby", "addr-help");
  history.replaceState(null, "", `?t=${hx}`);
  $("#head-q").value = "";
  intro.hidden = true;
  scrollTo({ top: 0, behavior: "auto" });
  const reg0 = await loadRegistry();
  if (!mine()) return;
  const rec = reg0?.records?.[hx];
  out.innerHTML = shell(hx, rec);
  const t0 = performance.now();
  const secs = () => ((performance.now() - t0) / 1000).toFixed(1);
  timer = setInterval(() => { const e = $("#elapsed"); if (e && mine()) e.textContent = `Running for ${secs()}s`; }, 100);

  step("bytes", "run", "GET substates/template_" + hx.slice(0, 8) + "...");
  step("rebuild", "run", "reading the register");
  step("attest", "run", "reading registry " + short(ONCHAIN.registry, 18));
  if (!rec) step("rebuild", "skip", reg0 ? "no rebuild on record for this template" : "register unavailable");
  else step("rebuild", rec.match && rec.clean ? "ok" : "warn",
    rec.match ? `run ${runNo(rec)}, ${rec.mode}${rec.clean ? "" : ", with warnings"}` : `run ${runNo(rec)}, closest build did not match`);

  const liveP = fetchTemplate(hx, (k, info) => {
    if (!mine()) return;
    step("bytes", "ok", `${info.size.toLocaleString()} bytes, epoch ${info.epoch}`);
    step("hash", "run", "sha256 with crypto.subtle");
    $("#in-name").textContent = info.name;
    $("#in-name").classList.remove("muted");
  }).then((v) => {
    if (mine()) step("hash", "ok", v.sha256);
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
  const finish = () => {
    clearInterval(timer);
    $("#elapsed").textContent = `Took ${secs()}s`;
    $("#stages-title").textContent = "What happened";
    $("#r-meter")?.remove();
  };

  if (e && (e.kind === "notfound" || !rec)) {
    step("compare", "skip", "nothing to compare");
    step("attest", "skip", "not needed");
    finish();
    $("#in-name").textContent = "Not found";
    $("#r-head").innerHTML = e.kind === "notfound"
      ? failHead("No template at this address on Ootle mainnet", `The indexer returned 404 for <code class="break">template_${esc(hx)}</code>. Check the address: component and resource addresses are not templates.`)
      : failHead("Could not read the template from the indexer", `Live check unavailable: ${esc(e.message || e.kind)}. There is no rebuild on record for this address either, so OneScan cannot say anything about it right now.`);
    $("#r-body").innerHTML = `<div class="actions"><a class="btn btn-primary" href="./?check">Check another template</a><a class="btn" href="board.html">Browse the proofs</a></div>`;
    return;
  }
  const liveErr = e ? `Live check unavailable: ${e.message || e.kind}. Showing the hashes recorded by the verifier run instead.` : "";

  let kind;
  if (!rec) { step("compare", "skip", "no rebuild to compare with"); kind = "none"; }
  else {
    const a = live ? live.sha256 : rec.onchain_sha256;
    const n = diffCount(a, rec.built_sha256);
    if (live) step("compare", n ? "fail" : "ok", n ? `${n} of 32 bytes differ` : "32 of 32 bytes equal");
    else step("compare", "warn", rec.match ? "recorded hashes equal" : "recorded hashes differ");
    kind = n === 0 && rec.match ? (rec.clean ? "ok" : "warn") : rec.match ? "withdrawn" : "bad";
  }

  const att = await attP;
  if (!mine()) return;
  if (att.error) step("attest", "fail", "registry unreadable");
  else {
    const a = att.byTemplate.get(hx)?.[0];
    if (!a) step("attest", "skip", "no attestation by the trusted key");
    else if (!live) step("attest", "warn", "exists, not compared");
    else if (a.onchain_sha256 !== live.sha256) step("attest", "fail", "attested hash differs");
    else if (kind === "ok" || kind === "warn") step("attest", "ok", `attested at epoch ${a.epoch}, trusted key ${short(a.verifier, 8)}`);
    else step("attest", "warn", "attested, but the bytes do not match a build");
  }
  finish();

  const name = live ? live.name : rec.name;
  $("#in-name").textContent = name;
  $("#in-name").classList.remove("muted");
  document.title = `${name}: ${VERDICT[kind].title} | OneScan`;
  $("#r-head").innerHTML = stamp({ ...VERDICT[kind], body: verdictBody(kind, live, rec), tag: "h1", press: true });
  $("#r-body").innerHTML = kind === "none" ? bodyUnverified(hx, live, att, kind)
    : kind === "withdrawn" ? bodyMismatch(hx, live, rec, att, kind)
    : kind === "bad" ? bodyFailed(hx, live, rec, liveErr, att, kind)
    : bodyVerified(hx, live, rec, liveErr, att, kind);
}

// ---------- wiring ----------
$("#lookup").addEventListener("submit", (ev) => { ev.preventDefault(); lookup($("#addr").value); });
$("#head-search").addEventListener("submit", (ev) => {
  if (!isCheck) return;
  ev.preventDefault();
  lookup($("#head-q").value);
});
document.querySelectorAll(".examples [data-t]").forEach((b) => b.addEventListener("click", () => lookup(b.dataset.t)));
wireCopy(out);
out.addEventListener("submit", (ev) => {
  if (ev.target.id !== "req") return;
  ev.preventDefault();
  const f = new FormData(ev.target), hx = ev.target.dataset.t;
  const q = new URLSearchParams({ template: "verify-request.yml", labels: "verify-request", title: `Verify template_${hx}`, address: `template_${hx}` });
  for (const k of ["repo", "commit", "workdir", "rustc", "remap"]) { const v = String(f.get(k) || "").trim(); if (v) q.set(k, v); }
  window.open(`https://github.com/${REPO}/issues/new?${q}`, "_blank", "noopener");
});

// ---------- home: every number below comes from the register or a live chain read ----------
const VX = {
  ok: { s: { tone: "ok", kicker: "Verdict", title: "Verified" }, text: "A public commit, rebuilt offline, gives the exact bytes on chain. All 32 sha256 bytes are equal and the build raised no warnings.", t: "67a658cc6c9e1c3564871e378f0a60d0b4f8682222460c34aa852caa961df309", ex: "Sealed Bids" },
  warn: { s: { tone: "warn", kicker: "Verdict", title: "Verified, with warnings" }, text: "The bytes match, but the build ran scripts or had other caveats that weaken what the match proves. Each warning is listed.", t: "9b41600aec8aaefb3c66e00567a060cafbb1e51fb4a904074f4faaabff6cb725", ex: "Specter Report Receipt" },
  bad: { s: { tone: "neutral", kicker: "Verdict", title: "Not reproduced" }, text: "The claimed source was rebuilt and did not give these bytes. Every such entry carries a diagnosed reason. It is not an accusation.", t: "65d9bbc931d306d2de9b235d7a0272f0dae05d061ed38f3c09467b972289b455", ex: "Signal Desk" },
  none: { s: { tone: "neutral", kicker: "Verdict", title: "Unverified" }, text: "The template is live on mainnet, but nobody has shown which source builds it. You can request a check from the result page.", t: null },
  mismatch: { s: { tone: "bad", kicker: "Previously verified", title: "Mismatch" }, text: "A rebuild once matched, but the bytes the indexer returns now hash differently. The earlier match is withdrawn.", t: null },
};
function verdictExplorer() {
  const panel = $("#vx-panel");
  const show = (k) => {
    const v = VX[k];
    panel.innerHTML = `${stamp({ ...v.s, small: true })}<div><p>${esc(v.text)}</p>
      ${v.t ? `<a class="btn mt-4" href="./?t=${v.t}">Check ${esc(v.ex)} live</a>` : `<p class="mt-3 small muted">None in the register today.</p>`}</div>`;
  };
  $("#vx .seg").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-v]");
    if (!b) return;
    document.querySelectorAll("#vx .seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    show(b.dataset.v);
  });
  show("ok");
}

const HEX = "0123456789abcdef";
function proofMachine(records, att) {
  const q = records.filter((r) => r.match && r.clean && !r.own).concat(records.filter((r) => r.own && r.clean));
  const body = $("#machine-body"), empty = $("#machine-empty");
  if (!q.length) { empty.textContent = "The ledger is empty for now."; return; }
  empty.hidden = true; body.hidden = false;
  const HASH = 34, HOLD = 90;
  let idx = 0, st = reduced ? HASH : 0;
  const draw = (fresh) => {
    const r = q[idx % q.length], h = r.onchain_sha256, done = st >= HASH;
    const known = Math.floor((Math.min(st, HASH) / HASH) * h.length);
    const attested = att && !att.error && att.byTemplate.get(r.template)?.[0]?.onchain_sha256 === h;
    if (fresh) body.innerHTML = `<dl>
        <div><dt>Template</dt><dd class="m-name machine-in"><a href="./?t=${r.template}">${esc(r.name)}</a></dd></div>
        <div class="m-two"><div><dt>Repo</dt><dd>${esc(repoName(r.repo))}</dd></div><div><dt>Commit</dt><dd class="mono">${esc((r.commit || "").slice(0, 12))}</dd></div></div>
        <div><dt>Bytes on chain, by sha256</dt><dd class="m-hash" aria-label="${h}" id="m-hash"></dd></div></dl>
        <div class="m-foot" id="m-foot"><span class="muted">Reading the hash</span></div>`;
    $("#m-hash").innerHTML = Array.from(h, (c, i) => (i < known ? `<span class="k">${c}</span>` : `<span class="u" aria-hidden="true">${i < known + 10 ? HEX[(i * 7 + st * 5) % 16] : "."}</span>`)).join("");
    if (done && !$("#m-foot .stamp-word")) {
      $("#m-foot").innerHTML = `<span class="stamp-word block-sage${reduced ? "" : " slam"}">Byte for byte${burst()}</span>${attested ? `<span class="chip block-lilac machine-in">Attested on Ootle</span>` : ""}`;
    }
  };
  draw(true);
  if (reduced) return;
  setInterval(() => {
    if (document.hidden) return;
    if (st >= HASH + HOLD) { idx++; st = 0; draw(true); } else { st++; if (st <= HASH) draw(false); }
  }, 60);
}

function ticker(records) {
  const rows = records.filter((r) => r.match);
  if (!rows.length) return;
  const li = (r, hidden) => `<li><a href="./?t=${r.template}"${hidden ? ' tabindex="-1"' : ""}>${esc(r.name)}</a><span>${esc(r.template.slice(0, 6))}...${esc(r.template.slice(-4))}</span><i aria-hidden="true"></i></li>`;
  const list = Array.from({ length: Math.ceil(14 / rows.length) }, () => rows).flat();
  $("#ticker").innerHTML = `<div class="ticker-track"><ul>${list.map((r) => li(r)).join("")}</ul><ul aria-hidden="true">${list.map((r) => li(r, true)).join("")}</ul></div>`;
}

async function home() {
  verdictExplorer();
  const attP = fetchAttestations().catch((e) => ({ error: String(e && e.message || e) }));
  const reg = await loadRegistry();
  const all = reg ? Object.values(reg.records) : [];
  if (reg) {
    countUp($("#n-rep"), reg.reproduced);
    countUp($("#n-all"), reg.attempted);
    $("#home-ledger").innerHTML = ledgerRows(all, 5);
    $("#cov").innerHTML = coverage(reg);
    ticker(all);
  } else {
    $("#n-rep").textContent = $("#n-all").textContent = "?";
    $("#home-ledger").innerHTML = `<li class="ledger-empty">The ledger could not be read just now.</li>`;
  }
  $("#tx-count").textContent = `${ONCHAIN.attestTxTemplates.size} attestations in one transaction`;
  const att = await attP;
  if (reg) proofMachine(all, att);
  else $("#machine-empty").textContent = "The ledger could not be read just now.";
  const live = $("#live"), self = $("#self-live");
  if (att.error) {
    live.innerHTML = `<span class="dot dot-warn"></span><span class="warn" role="status">Ootle mainnet not reachable right now</span>`;
    $("#n-att").textContent = "?";
    $("#att-now").textContent = "Could not read the registry: " + att.error;
    self.innerHTML = `<span class="dot dot-warn"></span><span>Could not read the registry just now</span>`;
    return;
  }
  const n = att.byTemplate.size;
  live.innerHTML = `<span class="dot dot-ok pulse"></span><span>Ootle mainnet registry, <b>${n}</b> templates attested</span>`;
  countUp($("#n-att"), n);
  $("#att-now").textContent = `${n} templates signed by the trusted key, read live just now`;
  const a = att.byTemplate.get(ONCHAIN.registryTemplate)?.[0];
  const own = reg?.records?.[ONCHAIN.registryTemplate];
  self.innerHTML = a && own && a.onchain_sha256 === own.onchain_sha256
    ? `<span class="dot dot-ok"></span><span>Attested on chain at epoch <b>${esc(a.epoch)}</b> by the trusted key</span>`
    : `<span class="dot dot-warn"></span><span>No matching attestation read for it just now</span>`;
}

async function checkSide() {
  const reg = await loadRegistry();
  $("#side-ledger").innerHTML = reg ? ledgerRows(Object.values(reg.records), 4) : `<li class="ledger-empty">The ledger could not be read just now.</li>`;
}

if (isCheck) {
  checkSide();
  const t = new URLSearchParams(location.search).get("t");
  if (t !== null) lookup(t);
  else $("#addr").focus({ preventScroll: true });
} else home();
