import { SITE, REPO, esc, short, parseAddress, fetchTemplate, parseTdef } from "./lib.js";

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
  const rows = [];
  if (live) rows.push(["On-chain, read live from the indexer and hashed in your browser", live.sha256]);
  else if (rec) rows.push(["On-chain, as recorded by the verifier run (live read unavailable)", rec.onchain_sha256]);
  if (rec) rows.push([rec.match ? `Built from source (${rec.mode})` : "Closest build from source", rec.built_sha256]);
  let eq = "";
  if (rec && live) eq = live.sha256 === rec.built_sha256 ? `<span class="eq ok">equal</span>` : `<span class="eq bad">different</span>`;
  return `<div class="hashes">${rows.map(([k, v], i) => `<div class="hash"><div class="k"><span>${esc(k)}</span>${i === 1 ? eq : ""}</div><div class="v">${esc(v)}</div></div>`).join("")}</div>
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

function verified(hx, live, rec, liveErr) {
  const recorded = !live;
  return `<div class="status s-ok"><div class="head"><span class="badge">VERIFIED</span><div>
      <div class="t">${esc(rec.name)}</div>
      <p>${recorded ? "The verifier run matched the on-chain bytes. A live re-check could not run in this browser, so the hash below is the recorded one." : "The bytes on chain right now are byte-identical to a reproducible build of this public commit."}</p></div></div>
    <div class="body">
      <div class="section">${hashBlock(live, rec, liveErr)}</div>
      <div class="section"><dl class="facts">
        <dt>Source</dt><dd>${ghLink(rec.repo, rec.commit)}</dd>
        <dt>Toolchain</dt><dd>${esc(rec.toolchain?.rustc || "")}${rec.toolchain?.tari_cli ? ", " + esc(rec.toolchain.tari_cli) : ""} on ${esc(rec.runner_os || "Linux")}</dd>
        <dt>Build mode</dt><dd>${esc(MODE[rec.mode] || rec.mode)}</dd>
        <dt>Verifier run</dt><dd><a href="${esc(rec.run_url)}">GitHub Actions run ${esc(rec.run_url.split("/").pop())}</a>, ${esc(rec.verified_at)}</dd>
        ${onchainFacts(hx, live)}
      </dl></div>
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

async function lookup(raw) {
  const hx = parseAddress(raw);
  if (!hx) {
    out.innerHTML = error("That is not a template address.", "Expected <code>template_</code> followed by 64 hex characters, or just the 64 hex characters.");
    return;
  }
  history.replaceState(null, "", `?t=${hx}`);
  $("#addr").value = `template_${hx}`;
  $("#go").disabled = true;
  out.innerHTML = `<p class="loading">Reading template_${short(hx)} from the indexer and hashing it…</p>`;
  const [reg, liveRes] = await Promise.all([loadRegistry(), fetchTemplate(hx).then((v) => ({ v }), (e) => ({ e }))]);
  $("#go").disabled = false;
  const rec = reg?.records?.[hx];
  const live = liveRes.v;
  const e = liveRes.e;
  if (e && e.kind === "notfound") {
    out.innerHTML = error("No template at this address on Ootle mainnet.", `The indexer returned 404 for <code>template_${esc(hx)}</code>. Check the address; component and resource addresses are not templates.`);
    return;
  }
  let liveErr = "";
  if (e) {
    liveErr = `Live check unavailable: ${e.message || e.kind}. ${rec ? "Showing the hashes recorded by the verifier run instead." : ""}`;
    if (!rec) { out.innerHTML = error("Could not read the template from the indexer.", esc(liveErr) + " No verification record exists for this address either, so OneScan cannot say anything about it right now."); return; }
  }
  if (!rec) out.innerHTML = unverified(hx, live);
  else if (rec.match && live && live.sha256 !== rec.built_sha256) out.innerHTML = mismatch(hx, live, rec);
  else if (rec.match) out.innerHTML = verified(hx, live, rec, liveErr);
  else out.innerHTML = notReproduced(hx, live, rec, liveErr);
}

$("#lookup").addEventListener("submit", (ev) => { ev.preventDefault(); lookup($("#addr").value); });
document.querySelectorAll(".try [data-t]").forEach((b) => b.addEventListener("click", () => lookup(b.dataset.t)));
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

const t = new URLSearchParams(location.search).get("t");
if (t) lookup(t);
