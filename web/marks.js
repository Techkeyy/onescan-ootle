// OneScan hallmarks: four original punch glyphs drawn as inline SVG.
// maker's mark  = template author key (initials, shield and device derived from the key bytes)
// standard mark = byte-for-byte reproduction ("32" = 32 of 32 sha256 bytes equal)
// office mark   = attestation in the OneScan SourceRegistry by the trusted verifier key
// date letter   = epoch of that attestation, as a cycling letter (A to Z, then the shield changes)
import { reduced } from "./site.js";

// Shared metal gradients, referenced by every mark on the page: the sunken field is darker at the top wall
// (in shadow) and lighter toward the bottom, where a punched recess catches the light.
if (typeof document !== "undefined" && !document.getElementById("mk-defs")) {
  document.body.insertAdjacentHTML("afterbegin", `<svg id="mk-defs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
    <linearGradient id="mk-steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f4448"/><stop offset=".55" stop-color="#5d6267"/><stop offset="1" stop-color="#767b80"/></linearGradient>
    <linearGradient id="mk-brass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f3a0c"/><stop offset=".55" stop-color="#6f5418"/><stop offset="1" stop-color="#8a6b25"/></linearGradient>
  </defs></svg>`);
}

const LETTERS = "ABCDEFGHJKLMNPRSTVWXYZ"; // 22 letters, no I, O, Q, U (too easily misread when punched small)
const bytesOf = (hx) => (hx || "").match(/../g)?.map((b) => parseInt(b, 16)) || [];

// Maker's mark parameters from the first bytes of the author key. Deterministic: same key, same mark.
export function makerParts(keyHex) {
  const b = bytesOf(keyHex);
  if (b.length < 6) return null;
  return {
    shape: b[0] % 4,
    initials: LETTERS[b[1] % 22] + LETTERS[b[2] % 22],
    device: b[3] % 4, // 0 none, 1 pellet, 2 four-point star, 3 bar beneath
    double: (b[4] & 1) === 1,
  };
}

const MAKER_SHAPES = [
  "M10 4H74L80 10V46L74 52H10L4 46V10Z", // clipped corners
  "M42 4C64 4 80 15 80 28S64 52 42 52 4 41 4 28 20 4 42 4Z", // oval
  "M28 4H56A24 24 0 0 1 56 52H28A24 24 0 0 1 28 4Z", // rounded ends
  "M14 4H70A10 10 0 0 0 80 14V42A10 10 0 0 0 70 52H14A10 10 0 0 0 4 42V14A10 10 0 0 0 14 4Z", // concave corners
];
const SHIELD = "M4 4H48V28C48 42 38 50 26 54C14 50 4 42 4 28Z";
const DATE_SHAPES = [
  "M10 4H42L48 10V46L42 52H10L4 46V10Z",
  "M26 2L48 12V44L26 54L4 44V12Z",
  "M16 4H36A12 12 0 0 1 48 16V40A12 12 0 0 1 36 52H16A12 12 0 0 1 4 40V16A12 12 0 0 1 16 4Z",
];

// Engraved letterforms: a dark offset copy under a light raised copy.
const raised = (x, y, size, text, extra = "") =>
  `<text x="${x + 0.7}" y="${y + 0.9}" class="mk-shade" font-size="${size}" ${extra}>${text}</text><text x="${x}" y="${y}" class="mk-raised" font-size="${size}" ${extra}>${text}</text>`;

// A punched recess: a light lip below (where the metal catches the light) under the sunken field.
const recess = (d) => `<path d="${d}" class="mk-hi" transform="translate(0 1.4)"/><path d="${d}" class="mk-recess"/>`;
const CIRCLE = "M28 3A25 25 0 1 1 27.9 3Z";

const wrap = (w, h, body, label) =>
  `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${label}" focusable="false">${body}</svg>`;

const cancelInk = (w, h) =>
  `<g class="mk-cancel"><path d="M${w * 0.12} ${h * 0.16}L${w * 0.88} ${h * 0.86}" pathLength="1"/><path d="M${w * 0.86} ${h * 0.14}L${w * 0.14} ${h * 0.88}" pathLength="1"/></g>`;

export function makerMark(keyHex) {
  const p = makerParts(keyHex);
  if (!p) return blankMark("maker");
  const d = MAKER_SHAPES[p.shape];
  const inner = p.double ? `<path d="${d}" class="mk-inner" transform="translate(42 28) scale(.84) translate(-42 -28)"/>` : "";
  const [a, c] = p.initials;
  let dev = "", text;
  if (p.device === 1) { dev = `<circle cx="42" cy="34" r="2.6" class="mk-raised-shape"/>`; text = raised(25, 39, 25, a) + raised(59, 39, 25, c); }
  else if (p.device === 2) { dev = `<path d="M42 27L44 32.5 49.5 34.5 44 36.5 42 42 40 36.5 34.5 34.5 40 32.5Z" class="mk-raised-shape"/>`; text = raised(24, 39, 25, a) + raised(60, 39, 25, c); }
  else if (p.device === 3) { dev = `<rect x="28" y="42" width="28" height="2.4" class="mk-raised-shape"/>`; text = raised(42, 37, 25, a + c, 'letter-spacing="2"'); }
  else text = raised(42, 39, 27, a + c, 'letter-spacing="1"');
  return wrap(84, 56, `${recess(d)}${inner}${dev}<g text-anchor="middle">${text}</g>`, `Maker's mark ${a}${c}`);
}

// state: struck | qualified | cancelled | blank
export function standardMark(state) {
  if (state === "blank") return blankMark("standard");
  const body = `${recess(SHIELD)}${state === "qualified" ? `<path d="${SHIELD}" class="mk-inner mk-dash" transform="translate(26 29) scale(.8) translate(-26 -29)"/>` : ""}
    <g text-anchor="middle">${raised(26, 33, 22, "32")}</g><rect x="15" y="38" width="22" height="2.2" class="mk-raised-shape"/>`;
  const label = state === "qualified" ? "Standard mark, qualified" : state === "cancelled" ? "Standard mark, cancelled" : "Standard mark";
  return wrap(52, 56, body + (state === "cancelled" ? cancelInk(52, 56) : ""), label);
}

export function officeMark(state = "struck") {
  if (state === "blank") return blankMark("office");
  return wrap(56, 56, `${recess(CIRCLE)}<circle cx="28" cy="28" r="13" class="mk-ring"/><rect x="7" y="26.6" width="42" height="2.8" class="mk-raised-shape"/>`, "Office mark of OneScan");
}

// Date letter: epoch mod 26 picks the letter, the 26-epoch cycle picks the shield and the case.
export function dateParts(epoch) {
  const e = Number(epoch);
  if (!Number.isFinite(e) || e < 0) return null;
  const cycle = Math.floor(e / 26);
  const ch = String.fromCharCode(65 + (e % 26));
  return { letter: cycle % 2 ? ch.toLowerCase() : ch, cycle, shape: cycle % 3 };
}
export function dateMark(epoch) {
  const p = dateParts(epoch);
  if (!p) return blankMark("date");
  return wrap(52, 56, `${recess(DATE_SHAPES[p.shape])}<g text-anchor="middle">${raised(26, 38, 30, p.letter)}</g>`, `Date letter ${p.letter}, epoch ${epoch}`);
}

const BLANK = { maker: [84, MAKER_SHAPES[0]], standard: [52, SHIELD], office: [56, CIRCLE], date: [52, DATE_SHAPES[0]] };
export function blankMark(kind) {
  const [w, d] = BLANK[kind];
  return wrap(w, 56, `<path d="${d}" class="mk-blank"/>`, "Not struck");
}

// Strike a mark into its slot. Animates only when motion is allowed; the caller decides whether the evidence supports it.
export function strike(slot, svg, cls = "") {
  if (!slot) return;
  slot.innerHTML = svg;
  slot.className = slot.className.replace(/\b(is-\w+)\b/g, "").trim() + (cls ? " " + cls : "");
  if (reduced) return;
  slot.classList.remove("punch");
  void slot.offsetWidth;
  slot.classList.add("punch");
  const bar = slot.closest("[data-strip]");
  if (bar) { bar.classList.remove("thud"); void bar.offsetWidth; bar.classList.add("thud"); }
}
