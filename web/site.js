// Shared UI helpers: scroll reveal, count-up from real numbers, the touchstone hash comparison.
export const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

export function reveal(root = document) {
  const els = root.querySelectorAll(".reveal:not(.in)");
  if (reduced || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  els.forEach((e) => io.observe(e));
}

// Run fn once when el scrolls into view (immediately without IntersectionObserver).
export function whenVisible(el, fn, threshold = 0.3) {
  if (!el) return;
  if (!("IntersectionObserver" in window)) return fn();
  const io = new IntersectionObserver((en) => { if (en.some((x) => x.isIntersecting)) { io.disconnect(); fn(); } }, { threshold });
  io.observe(el);
}

// Animate an element's text from 0 to n (an integer that came from real data).
export function countUp(el, n, ms = 900) {
  if (!el) return;
  if (reduced || !Number.isFinite(n) || n <= 0) { el.textContent = String(n); return; }
  const t0 = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3);
    el.textContent = String(Math.round(n * e));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function diffCount(a, b) {
  let n = 0;
  for (let i = 0; i < 32; i++) if (a.slice(i * 2, i * 2 + 2) !== b.slice(i * 2, i * 2 + 2)) n++;
  return n;
}

// Touchstone: one column per sha256 byte, upper streak = on-chain, lower streak = rebuilt.
// The byte's value sets the streak's length, so equal bytes leave identical streaks and divergent bytes show off-colour.
export function streaks(a, b) {
  const len = (h) => (h ? 30 + Math.round((parseInt(h, 16) / 255) * 70) : 0);
  const cols = [];
  for (let i = 0; i < 32; i++) {
    const x = a ? a.slice(i * 2, i * 2 + 2) : "";
    const y = b ? b.slice(i * 2, i * 2 + 2) : "";
    const st = a && b ? (x === y ? "eq" : "ne") : "";
    cols.push(`<span class="col ${st}" style="--i:${i}"><b>${x || "··"}</b><i style="--l:${len(x)}%"></i><i style="--l:${len(y)}%"></i><b>${y || "··"}</b></span>`);
  }
  return cols.join("");
}
