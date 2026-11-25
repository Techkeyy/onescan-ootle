// Shared UI helpers in the OneScan design system. Everything that moves here moves on real data.
import { esc, isHex64 } from "./lib.js";

export const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Run fn once when el scrolls into view (immediately without IntersectionObserver).
export function whenVisible(el, fn, threshold = 0.3) {
  if (!el) return;
  if (!("IntersectionObserver" in window)) return fn();
  const io = new IntersectionObserver((en) => { if (en.some((x) => x.isIntersecting)) { io.disconnect(); fn(); } }, { threshold });
  io.observe(el);
}

// Count an element up from 0 to n (an integer that came from real data) the first time it is seen.
export function countUp(el, n, ms = 1100) {
  if (!el) return;
  if (reduced || !Number.isFinite(n) || n <= 0) { el.textContent = String(n); return; }
  whenVisible(el, () => {
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(n * e));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(() => (el.textContent = String(n)), ms + 400); // lands on the real number even if frames are throttled
  }, 0.2);
}

// The OneScan seal: a double ring with a check. The check can draw itself once on a real verdict.
export const seal = (cls = "", draw = false) => `<svg class="${cls}" viewBox="0 0 26 26" fill="none" aria-hidden="true"><circle cx="13" cy="13" r="11.5" stroke="currentColor" stroke-width="2"/><circle cx="13" cy="13" r="8" stroke="currentColor" stroke-width="1"/><path d="M8.8 13.3l3 3 5.4-6" pathLength="1" ${draw ? 'class="seal-check"' : ""} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const BURST = [["-46px", "-30px", "120deg", "#c9c6ff"], ["-10px", "-44px", "-80deg", "#a9dcc6"], ["34px", "-34px", "160deg", "#efedf9"],
  ["50px", "6px", "90deg", "#c9c6ff"], ["26px", "36px", "200deg", "#a9dcc6"], ["-30px", "32px", "-140deg", "#efedf9"]];
// Flat squares thrown out once by a stamp when a real match lands.
export const burst = () => (reduced ? "" : `<span class="burst" aria-hidden="true">${BURST.map(([x, y, r, c]) => `<i style="--x:${x};--y:${y};--r:${r};--c:${c}"></i>`).join("")}</span>`);

export const TONE = { ok: "block-sage", warn: "block-sand", bad: "block-clay", neutral: "block-paper" };

// The verdict stamp. `tag` is h1 on a result, a p elsewhere.
export function stamp({ tone, kicker, title, body = "", tag = "p", small = false, press = false }) {
  const sealed = tone === "ok";
  return `<div class="stamp ${TONE[tone]}${small ? " stamp-sm" : ""}${press && !reduced ? " press" : ""}">
    <div><p class="kick">${esc(kicker)}</p><${tag} class="st-title">${esc(title)}</${tag}>${body ? `<div class="st-body">${body}</div>` : ""}</div>
    ${sealed ? `<span class="seal-big">${seal("", press)}${press ? burst() : ""}</span>` : ""}</div>`;
}

export const notice = (tone, title, body = "", role = "") =>
  `<div class="notice notice-${tone}"${role ? ` role="${role}"` : ""}>${title ? `<span class="nt">${title}</span>` : ""}${body ? `<div>${body}</div>` : ""}</div>`;

export const copyBtn = (text, label = "Copy") => `<button type="button" class="copy" data-copy="${esc(text)}" data-label="${esc(label)}">${esc(label)}</button>`;

// One click handler per root for every copy button inside it.
export function wireCopy(root) {
  root.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-copy]");
    if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copied"; } catch { b.textContent = "Press Ctrl+C"; }
    setTimeout(() => (b.textContent = b.dataset.label || "Copy"), 1800);
  });
}

// Proof ledger rows: the templates whose bytes match a public build, newest first.
export function ledgerRows(records, limit) {
  const rows = records.filter((r) => r.match && isHex64(r.template)).sort((a, b) => String(b.verified_at).localeCompare(String(a.verified_at))).slice(0, limit);
  if (!rows.length) return `<li class="ledger-empty">The ledger is empty. A row appears here only when a template really rebuilds.</li>`;
  return rows.map((r) => {
    const repo = (r.repo || "").replace("https://github.com/", "");
    return `<li><a href="./?t=${r.template}">${seal(`seal${r.clean ? "" : " w"}`)}
      <span style="min-width:0"><span class="t">${esc(r.name)}</span><span class="s">${esc(repo)} <span class="mono">${esc(r.template.slice(0, 6))}...${esc(r.template.slice(-4))}</span></span></span>
      <span class="r"><b class="${r.clean ? "ok" : "warn"}">${r.clean ? "Byte for byte" : "With warnings"}</b><span class="muted">${esc(String(r.verified_at || "").slice(0, 10))}</span></span></a></li>`;
  }).join("");
}

// Coverage: how many of the checked templates rebuild, as a meter from the register's own numbers.
export function coverage(reg) {
  const pct = reg.attempted ? Math.round((reg.reproduced / reg.attempted) * 100) : 0;
  return `<div class="meter" role="img" aria-label="${reg.reproduced} of ${reg.attempted} rebuild"><i style="width:${Math.max(2, pct)}%"></i></div>
    <p><b>${reg.reproduced}</b> of the <b>${reg.attempted}</b> third-party templates OneScan has checked rebuild byte for byte, ${reg.clean} of them with no warnings. Every one that does not has a diagnosed reason.</p>`;
}
