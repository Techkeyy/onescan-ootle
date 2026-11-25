// Shared UI helpers: scroll reveal, count-up from real numbers, sha256 byte grids.
export const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

export function reveal(root = document) {
  const els = root.querySelectorAll(".reveal:not(.in)");
  if (reduced || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  els.forEach((e) => io.observe(e));
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

// 32 cells for a 64-char hex. With `other`, each byte is marked equal (eq) or divergent (ne).
export function bytesHTML(hx, other) {
  const cells = [];
  for (let i = 0; i < 32; i++) {
    const b = hx ? hx.slice(i * 2, i * 2 + 2) : "··";
    const cls = !hx ? "" : other ? (other.slice(i * 2, i * 2 + 2) === b ? "eq" : "ne") : "solo";
    cells.push(`<i class="${cls}" style="--i:${i}">${b}</i>`);
  }
  return cells.join("");
}

export function diffCount(a, b) {
  let n = 0;
  for (let i = 0; i < 32; i++) if (a.slice(i * 2, i * 2 + 2) !== b.slice(i * 2, i * 2 + 2)) n++;
  return n;
}
