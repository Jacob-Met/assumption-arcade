// Assumption Arcade core: safe expression parser + deterministic theorem checkers.
// Pure ES module, shared by the browser, the server and the tests. No dependencies.

// ---------- expression parser (no eval) ----------
const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan, abs: Math.abs, sqrt: Math.sqrt,
  cbrt: Math.cbrt, exp: Math.exp, ln: Math.log, log: Math.log, floor: Math.floor, ceil: Math.ceil,
  round: Math.round, sign: Math.sign, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  min: Math.min, max: Math.max, pow: Math.pow, mod: (a, b) => a - b * Math.floor(a / b),
};
const CONSTS = { pi: Math.PI, e: Math.E, inf: Infinity };

export function compile(src) {
  if (typeof src !== "string") throw new Error("expression must be text");
  if (src.length > 240) throw new Error("expression too long (240 chars max)");
  const s = src.replace(/\s+/g, "").replace(/π/g, "pi").replace(/\*\*/g, "^");
  let i = 0, depth = 0;
  const peek = () => s[i];
  function fail(m) { throw new Error(m + " (at position " + i + ")"); }
  function cmp() {
    let l = add();
    for (;;) {
      const t = s.slice(i, i + 2), c = s[i];
      let op = null;
      if (t === "<=" || t === ">=" || t === "==" || t === "!=") { op = t; i += 2; }
      else if (c === "<" || c === ">") { op = c; i += 1; }
      if (!op) return l;
      const L = l, R = add();
      l = (x) => { const a = L(x), b = R(x);
        return (op === "<" ? a < b : op === ">" ? a > b : op === "<=" ? a <= b : op === ">=" ? a >= b : op === "==" ? a === b : a !== b) ? 1 : 0; };
    }
  }
  function add() {
    let l = mul();
    while (peek() === "+" || peek() === "-") {
      const op = s[i++], L = l, R = mul();
      l = op === "+" ? (x) => L(x) + R(x) : (x) => L(x) - R(x);
    }
    return l;
  }
  function mul() {
    let l = unary();
    for (;;) {
      const c = peek();
      if (c === "*" || c === "/") {
        i++; const L = l, R = unary();
        l = c === "*" ? (x) => L(x) * R(x) : (x) => L(x) / R(x);
      } else if (c !== undefined && /[0-9.a-z_(]/i.test(c)) { // implicit product: 5x, 2(x+1)
        const L = l, R = unary(); l = (x) => L(x) * R(x);
      } else return l;
    }
  }
  function unary() {
    if (peek() === "-") { i++; const u = unary(); return (x) => -u(x); }
    if (peek() === "+") { i++; return unary(); }
    return pow();
  }
  function pow() {
    const base = atom();
    if (peek() === "^") { i++; const ex = unary(); return (x) => Math.pow(base(x), ex(x)); }
    return base;
  }
  function atom() {
    if (++depth > 40) fail("expression nested too deeply");
    let r;
    const c = peek();
    if (c === "(") { i++; r = cmp(); if (peek() !== ")") fail("missing )"); i++; }
    else if (c !== undefined && /[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(s.slice(i));
      if (!m) fail("bad number");
      i += m[0].length; const v = parseFloat(m[0]); r = () => v;
    } else if (c !== undefined && /[a-z_]/i.test(c)) {
      const m = /^[a-z_][a-z_0-9]*/i.exec(s.slice(i))[0]; i += m.length;
      const name = m.toLowerCase();
      if (peek() === "(") {
        i++;
        const args = [];
        if (peek() !== ")") { args.push(cmp()); while (peek() === ",") { i++; args.push(cmp()); } }
        if (peek() !== ")") fail("missing ) after arguments");
        i++;
        if (name === "if") {
          if (args.length !== 3) fail("if(cond, a, b) takes 3 arguments");
          const [C, A, B] = args; r = (x) => (C(x) ? A(x) : B(x));
        } else if (FUNCS[name]) {
          const F = FUNCS[name]; r = (x) => F(...args.map((g) => g(x)));
        } else fail("unknown function " + name);
      } else if (name === "x") r = (x) => x;
      else if (name in CONSTS) { const v = CONSTS[name]; r = () => v; }
      else fail("unknown name " + name);
    } else fail(c === undefined ? "unexpected end of expression" : "unexpected '" + c + "'");
    depth--;
    return r;
  }
  if (!s.length) throw new Error("expression is empty");
  const f = cmp();
  if (i < s.length) fail("unexpected '" + s[i] + "'");
  return f;
}

// ---------- numeric analysis helpers ----------
const lin = (a, b, n) => Array.from({ length: n }, (_, k) => a + ((b - a) * k) / (n - 1));
const fin = Number.isFinite;

export function fmt(n) {
  if (n === Infinity) return "∞";
  if (n === -Infinity) return "-∞";
  if (!fin(n)) return String(n);
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return n.toExponential(2);
  return String(Math.round(n * 1e4) / 1e4);
}

// Jumps/poles that do not shrink under refinement => discontinuity.
function scanContinuity(f, xs) {
  const bad = [];
  const ys = xs.map(f);
  for (let i = 0; i < xs.length; i++) if (!fin(ys[i])) return { ok: false, at: [xs[i]], why: "f(" + fmt(xs[i]) + ") is not a finite number" };
  const gaps = [];
  for (let i = 0; i + 1 < xs.length; i++) gaps.push({ i, d: Math.abs(ys[i + 1] - ys[i]) });
  gaps.sort((p, q) => q.d - p.d);
  for (const g of gaps.slice(0, 40)) {
    if (g.d < 1e-4) break;
    let l = xs[g.i], r = xs[g.i + 1];
    const d0 = g.d;
    let d = d0;
    for (let k = 0; k < 70; k++) {
      const m = (l + r) / 2;
      if (m <= l || m >= r) break;
      const fl = f(l), fm = f(m), fr = f(r);
      if (!fin(fm)) { d = Infinity; break; }
      const dl = Math.abs(fm - fl), dr = Math.abs(fr - fm);
      if (dl >= dr) { r = m; d = dl; } else { l = m; d = dr; }
    }
    if (d > 0.25 * d0 && d > 1e-4) {
      let c = (l + r) / 2;
      const nice = Number(c.toPrecision(10));
      if (Math.abs(nice - c) < 1e-9 * Math.max(1, Math.abs(c))) c = nice; // jumps usually sit at round numbers
      bad.push({ x: c, jump: d });
    }
  }
  if (!bad.length) return { ok: true, at: [] };
  return { ok: false, at: bad.map((q) => q.x), why: "f jumps by about " + fmt(bad[0].jump) + " near x = " + fmt(bad[0].x) };
}

// Corners/cusps: slope change that does not shrink under refinement.
function scanCorners(f, xs) {
  const ys = xs.map(f), ch = [];
  for (let i = 1; i + 1 < xs.length; i++) {
    const s1 = (ys[i] - ys[i - 1]) / (xs[i] - xs[i - 1]), s2 = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    ch.push({ i, d: Math.abs(s2 - s1) });
  }
  ch.sort((p, q) => q.d - p.d);
  const bad = [];
  const dd = (p, q) => { const m = (p + q) / 2; return Math.abs((f(q) - f(m)) / (q - m) - (f(m) - f(p)) / (m - p)); };
  for (const c of ch.slice(0, 40)) {
    const ddc = (m, w) => dd(m - w / 2, m + w / 2);
    let w = xs[c.i + 1] - xs[c.i - 1], m = xs[c.i];
    const d0 = ddc(m, w);
    if (!(d0 >= 1e-3)) continue;
    let d = d0;
    for (let k = 0; k < 24; k++) {
      w /= 2;
      let bm = m, bd = -1;
      for (const cm of [m - w / 2, m, m + w / 2]) { const v = ddc(cm, w); if (v > bd) { bd = v; bm = cm; } }
      m = bm; d = bd;
    }
    const P = m, Q = m;
    if (d > 0.3 * d0 && d > 1e-3) bad.push({ x: (P + Q) / 2, d });
  }
  if (!bad.length) return { ok: true, at: [] };
  return { ok: false, at: bad.map((q) => q.x), why: "the slope changes abruptly (by about " + fmt(bad[0].d) + ") at x = " + fmt(bad[0].x) + ": a corner or cusp" };
}

// Find x with g(x)=0 (g may be NaN = undefined). Sign changes are bisected and the residual must
// vanish: a jump across the target is a sign change but NOT a root.
function findZero(g, xs, tol) {
  const v = xs.map(g);
  const refine = (l, r) => {
    let gl = g(l);
    for (let k = 0; k < 80; k++) {
      const m = (l + r) / 2, gm = g(m);
      if (!fin(gm)) return null;
      if (Math.abs(gm) <= tol) return { x: m, v: gm };
      if (Math.sign(gm) === Math.sign(gl)) { l = m; gl = gm; } else { r = m; }
    }
    const m = (l + r) / 2, gm = g(m);
    return fin(gm) && Math.abs(gm) <= tol ? { x: m, v: gm } : null;
  };
  for (let i = 0; i < xs.length; i++) if (fin(v[i]) && Math.abs(v[i]) <= tol) return { x: xs[i], v: v[i] };
  for (let i = 0; i + 1 < xs.length; i++)
    if (fin(v[i]) && fin(v[i + 1]) && Math.sign(v[i]) !== Math.sign(v[i + 1])) { const r = refine(xs[i], xs[i + 1]); if (r) return r; }
  for (let i = 1; i + 1 < xs.length; i++) { // tangential zeros: local minima of |g|
    const a = Math.abs(v[i - 1]), b = Math.abs(v[i]), c = Math.abs(v[i + 1]);
    if (fin(a) && fin(b) && fin(c) && b <= a && b <= c) {
      let l = xs[i - 1], r = xs[i + 1];
      for (let k = 0; k < 80; k++) {
        const m1 = l + (r - l) / 3, m2 = r - (r - l) / 3;
        if (Math.abs(g(m1)) < Math.abs(g(m2))) r = m2; else l = m1;
      }
      const m = (l + r) / 2, gm = g(m);
      if (fin(gm) && Math.abs(gm) <= Math.max(tol, 1e-7)) return { x: m, v: gm };
    }
  }
  return null;
}

// derivative estimate that refuses to answer at corners (one-sided slopes disagree)
function derivative(f, x, h) {
  const l = (f(x) - f(x - h)) / h, r = (f(x + h) - f(x)) / h;
  if (!fin(l) || !fin(r)) return NaN;
  if (Math.abs(l - r) > 1e-2 * (1 + Math.abs(l) + Math.abs(r))) return NaN;
  return (f(x + h) - f(x - h)) / (2 * h);
}

// ---------- theorems ----------
export const THEOREMS = {
  ivt: {
    id: "ivt", name: "Intermediate Value Theorem",
    statement: "If f is continuous on [a, b] and y lies strictly between f(a) and f(b), then f(c) = y for some c in (a, b).",
    conclusionText: "some c in (a, b) has f(c) = y",
    assumptions: [
      { id: "continuous", label: "f is continuous on [a, b]" },
      { id: "bracket", label: "y is strictly between f(a) and f(b)" },
    ],
    defaults: { expr: "x", a: 0, b: 1, y: 0.5 },
  },
  rolle: {
    id: "rolle", name: "Rolle's Theorem",
    statement: "If f is continuous on [a, b], differentiable on (a, b), and f(a) = f(b), then f'(c) = 0 for some c in (a, b).",
    conclusionText: "some c in (a, b) has f′(c) = 0",
    assumptions: [
      { id: "continuous", label: "f is continuous on [a, b]" },
      { id: "differentiable", label: "f is differentiable on (a, b)" },
      { id: "equal", label: "f(a) = f(b)" },
    ],
    defaults: { expr: "x*(1-x)", a: 0, b: 1 },
  },
  evt: {
    id: "evt", name: "Extreme Value Theorem",
    statement: "If f is continuous on a closed, bounded interval, then f attains a maximum value at some point of that interval.",
    conclusionText: "f attains a maximum on the interval",
    assumptions: [
      { id: "continuous", label: "f is continuous on the interval" },
      { id: "closed", label: "the interval is closed (includes both endpoints)" },
      { id: "bounded", label: "the interval is bounded (b is finite)" },
    ],
    defaults: { expr: "sin(x)", a: 0, b: 3, closedA: true, closedB: true },
  },
};

const num = (v, d) => {
  const n = typeof v === "string" ? (v.trim().toLowerCase() === "inf" ? Infinity : Number(v)) : v;
  return n === undefined || n === null || Number.isNaN(n) ? d : n;
};

function hypIVT(f, p, id) {
  const { a, b, y } = p;
  if (id === "continuous") {
    const r = scanContinuity(f, lin(a, b, 2001));
    return { holds: r.ok, detail: r.ok ? "no jump or pole found on [a, b]" : r.why, marks: r.at };
  }
  const fa = f(a), fb = f(b);
  if (!fin(fa) || !fin(fb)) return { holds: false, detail: "f(a) or f(b) is not a finite number" };
  const ok = (fa < y && y < fb) || (fb < y && y < fa);
  return { holds: ok, detail: "f(a) = " + fmt(fa) + ", f(b) = " + fmt(fb) + ", y = " + fmt(y) };
}
function concIVT(f, p) {
  const { a, b, y } = p;
  const xs = lin(a, b, 6001).slice(1, -1);
  const z = findZero((x) => f(x) - y, xs, 1e-7);
  return z ? { holds: true, detail: "f(" + fmt(z.x) + ") = " + fmt(y), witness: { x: z.x, y: f(z.x) } }
    : { holds: false, detail: "f never equals " + fmt(y) + " on (a, b): every crossing is a jump or a gap, not a value" };
}
function hypRolle(f, p, id) {
  const { a, b } = p;
  if (id === "continuous") {
    const r = scanContinuity(f, lin(a, b, 2001));
    return { holds: r.ok, detail: r.ok ? "no jump or pole found on [a, b]" : r.why, marks: r.at };
  }
  if (id === "equal") {
    const fa = f(a), fb = f(b);
    return { holds: fin(fa) && fin(fb) && Math.abs(fa - fb) < 1e-9, detail: "f(a) = " + fmt(fa) + ", f(b) = " + fmt(fb) };
  }
  const inner = lin(a, b, 2001).slice(1, -1);
  const c = scanContinuity(f, inner);
  if (!c.ok) return { holds: false, detail: "not even continuous: " + c.why, marks: c.at };
  const r = scanCorners(f, inner);
  return { holds: r.ok, detail: r.ok ? "smooth everywhere on (a, b)" : "not differentiable: " + r.why, marks: r.at };
}
function concRolle(f, p) {
  const { a, b } = p, h = 1e-6 * (b - a);
  const xs = lin(a, b, 6001).slice(1, -1);
  const z = findZero((x) => derivative(f, x, h), xs, 1e-4);
  return z ? { holds: true, detail: "f′(" + fmt(z.x) + ") ≈ 0", witness: { x: z.x, y: f(z.x) } }
    : { holds: false, detail: "f′ is never 0 on (a, b): where it would cross 0 it does not exist, or it never gets there" };
}

function domainInfo(p) {
  const bInf = !fin(p.b);
  return { bInf, closedA: !!p.closedA, closedB: bInf ? false : !!p.closedB };
}
function evtPoints(p, disc) {
  const { a } = p, D = domainInfo(p);
  const hi = D.bInf ? a + 1000 : p.b, span = hi - a;
  const pts = [], specials = [];
  lin(a, hi, 4001).forEach((x, k) => {
    if ((k === 0 && !D.closedA) || (k === 4000 && (D.bInf || !D.closedB))) return;
    pts.push({ x, kind: "grid" });
  });
  const probes = (s, side) => {
    for (let k = 3; k <= 12; k++) { const x = s + side * span * Math.pow(10, -k); if (x > a && x < hi) pts.push({ x, kind: "probe", s }); }
  };
  if (!D.closedA) { specials.push({ s: a, inDomain: false }); probes(a, 1); }
  if (!D.bInf && !D.closedB) { specials.push({ s: p.b, inDomain: false }); probes(p.b, -1); }
  for (const c of disc || []) { specials.push({ s: c, inDomain: true }); probes(c, 1); probes(c, -1); pts.push({ x: c, kind: "exact" }); }
  return { pts, specials, span, D, hi };
}
function hypEVT(f, p, id) {
  const D = domainInfo(p);
  if (id === "closed") return { holds: D.closedA && (D.bInf || D.closedB), detail: "interval is " + (D.closedA ? "[" : "(") + fmt(p.a) + ", " + fmt(p.b) + (D.bInf || !D.closedB ? ")" : "]") };
  if (id === "bounded") return { holds: !D.bInf, detail: D.bInf ? "the interval runs off to ∞" : "b = " + fmt(p.b) + " is finite" };
  const hi = D.bInf ? p.a + 1000 : p.b;
  const xs = lin(p.a, hi, 2001);
  if (!D.closedA) xs.shift();
  if (D.bInf || !D.closedB) xs.pop();
  const r = scanContinuity(f, xs);
  return { holds: r.ok, detail: r.ok ? "no jump or pole found on the interval" : r.why, marks: r.at };
}
function concEVT(f, p, ctx) {
  const { pts, specials, D, span, hi } = evtPoints(p, ctx.disc);
  let best = null;
  const tol = 1e-12;
  for (const q of pts) {
    const v = f(q.x);
    if (!fin(v)) continue;
    q.v = v;
    const t = tol * (1 + Math.abs(best ? best.v : 0));
    if (!best || v > best.v + t || (Math.abs(v - best.v) <= t && q.kind !== "probe" && best.kind === "probe")) best = q;
  }
  if (!best) return { holds: false, detail: "f has no finite values on the interval" };
  if (D.bInf) {
    const nearV = Math.max(...pts.filter((q) => fin(q.v)).map((q) => q.v));
    let far = -Infinity;
    for (let k = 3; k <= 9; k++) for (const m of [1, 2.7, 5.1]) { const v = f(p.a + m * Math.pow(10, k)); if (fin(v) && v > far) far = v; }
    if (far > nearV + 1e-9 * (1 + Math.abs(nearV)))
      return { holds: false, detail: "f keeps getting larger as x runs off to ∞, so no point is a maximum" };
    best = pts.find((q) => q.v === nearV);
  } else if (best.kind === "probe") {
    const sp = specials.find((s) => s.s === best.s);
    const atS = sp && sp.inDomain ? f(sp.s) : NaN;
    if (!(fin(atS) && atS >= best.v - 1e-9 * (1 + Math.abs(best.v))))
      return { holds: false, detail: "f climbs toward " + fmt(best.v) + " as x approaches " + fmt(best.s) + " but never reaches it: the supremum is not attained" };
    best = { x: best.s, v: atS, kind: "exact" };
  }
  if (best.kind === "grid") {
    const st = span / 4000;
    let l = Math.max(p.a, best.x - st), r = Math.min(hi, best.x + st);
    for (let k = 0; k < 80; k++) { const m1 = l + (r - l) / 3, m2 = r - (r - l) / 3; if (f(m1) < f(m2)) l = m1; else r = m2; }
    const m = (l + r) / 2;
    if (f(m) >= best.v) best = { x: m, v: f(m) };
  }
  return { holds: true, detail: "max is f(" + fmt(best.x) + ") = " + fmt(best.v), witness: { x: best.x, y: best.v } };
}

const HYP = { ivt: hypIVT, rolle: hypRolle, evt: hypEVT };

export function normalizeParams(thId, raw, assume) {
  const d = THEOREMS[thId].defaults;
  const p = { a: num(raw.a, d.a), b: num(raw.b, d.b) };
  if (thId === "ivt") p.y = num(raw.y, d.y);
  if (thId === "evt") {
    p.closedA = raw.closedA === undefined ? true : !!raw.closedA;
    p.closedB = raw.closedB === undefined ? true : !!raw.closedB;
    if (assume && assume.closed !== false) { p.closedA = true; p.closedB = true; }
    if (assume && assume.bounded !== false && !fin(p.b)) p.b = d.b;
  }
  return p;
}

/**
 * check(thId, {expr, ...params}, assume) -> verdict.
 * assume: { [assumptionId]: boolean }  true = player keeps the hypothesis, false = dropped.
 * status: "error" | "rejected" | "holds" | "counterexample"
 */
export function check(thId, input, assume) {
  const th = THEOREMS[thId];
  if (!th) return { status: "error", message: "unknown theorem" };
  assume = assume || Object.fromEntries(th.assumptions.map((a) => [a.id, true]));
  let f;
  try { f = compile(String(input.expr)); } catch (e) { return { status: "error", message: "Cannot read that expression: " + e.message }; }
  const p = normalizeParams(thId, input, assume);
  if (!(fin(p.a) && p.b > p.a)) return { status: "error", message: "Need finite a < b (b may be inf only for the Extreme Value Theorem)." };
  if (thId !== "evt" && !fin(p.b)) return { status: "error", message: "b must be finite for this theorem." };
  if (thId === "ivt" && !fin(p.y)) return { status: "error", message: "y must be a number." };
  const hyps = th.assumptions.map((a) => {
    const r = HYP[thId](f, p, a.id);
    return { id: a.id, label: a.label, assumed: assume[a.id] !== false, holds: r.holds, detail: r.detail, marks: r.marks || [] };
  });
  const disc = hyps.find((h) => h.id === "continuous").marks;
  const conc = thId === "ivt" ? concIVT(f, p) : thId === "rolle" ? concRolle(f, p) : concEVT(f, p, { disc });
  const violated = hyps.filter((h) => !h.holds);
  const brokenAssumed = violated.filter((h) => h.assumed);
  const brokenDropped = violated.filter((h) => !h.assumed);
  const out = { theorem: thId, params: p, hypotheses: hyps, conclusion: conc, broken: brokenDropped.map((h) => h.id) };
  const q = (hs) => hs.map((h) => "“" + h.label + "”").join(" and ");
  if (brokenAssumed.length) {
    out.status = "rejected";
    out.message = "Not allowed: this f breaks " + q(brokenAssumed) + ", which you are still assuming (" + brokenAssumed.map((h) => h.detail).join("; ") + ").";
  } else if (conc.holds) {
    out.status = "holds";
    out.message = brokenDropped.length
      ? "The conclusion survives: " + conc.detail + ". This f breaks " + q(brokenDropped) + ", but that is not enough to stop it here."
      : "Every assumption holds, so the theorem promises the conclusion, and it delivers: " + conc.detail + ".";
  } else if (brokenDropped.length) {
    out.status = "counterexample";
    out.message = "Valid counterexample. Every assumption you kept holds, the conclusion fails (" + conc.detail + "), and the broken hypothesis is " + q(brokenDropped) + ": " + brokenDropped.map((h) => h.detail).join("; ") + ".";
  } else {
    out.status = "error";
    out.message = "Every hypothesis checks out yet the conclusion fails. That cannot happen in theory, so the numerics are at their limit for this f. Try a gentler function.";
  }
  return out;
}

// Curated counterexamples. Each is verified by the checker (see tests) and powers the necessity map.
export const LIBRARY = [
  { th: "ivt", drop: "continuous", expr: "if(x<0.5,-1,1)", a: 0, b: 1, y: 0, note: "A jump straight over the line y = 0." },
  { th: "ivt", drop: "continuous", expr: "1/x", a: -1, b: 2, y: 0, note: "A pole at 0 sends the graph off to ±∞ instead of through 0." },
  { th: "ivt", drop: "bracket", expr: "x^2", a: -1, b: 2, y: -1, note: "y = -1 is below both endpoint values, so nothing forces a crossing." },
  { th: "rolle", drop: "continuous", expr: "if(x<1,x,0)", a: 0, b: 1, note: "Climbs to 1 then drops to 0 exactly at b: f(a) = f(b), yet the slope is always 1." },
  { th: "rolle", drop: "differentiable", expr: "abs(x)", a: -1, b: 1, note: "The corner at 0 sits exactly where a flat tangent should have been." },
  { th: "rolle", drop: "equal", expr: "x", a: 0, b: 1, note: "Different endpoint heights: the slope is 1 everywhere." },
  { th: "evt", drop: "closed", expr: "x", a: 0, b: 1, closedA: false, closedB: false, note: "Climbs toward 1 on (0, 1) but never touches it." },
  { th: "evt", drop: "closed", expr: "1/x", a: 0, b: 1, closedA: false, closedB: true, note: "Blows up at the open end 0." },
  { th: "evt", drop: "bounded", expr: "x", a: 0, b: Infinity, closedA: true, closedB: false, note: "Closed but not bounded: it grows forever." },
  { th: "evt", drop: "continuous", expr: "if(x<1,x,0)", a: 0, b: 1, closedA: true, closedB: true, note: "Closed and bounded, but the jump at 1 removes the top." },
];

// For each assumption: does a checker-verified counterexample exist that breaks only it?
export function necessityMap(thId) {
  const th = THEOREMS[thId];
  return th.assumptions.map((a) => {
    const assume = Object.fromEntries(th.assumptions.map((x) => [x.id, x.id !== a.id]));
    const witnesses = LIBRARY.filter((l) => l.th === thId && l.drop === a.id)
      .map((l) => ({ ...l, verdict: check(thId, l, assume).status }))
      .filter((w) => w.verdict === "counterexample");
    return { id: a.id, label: a.label, necessary: witnesses.length > 0, witnesses };
  });
}

// Samples for plotting: [{x, y|null}]
export function sampleCurve(expr, a, b, n = 720) {
  const f = compile(expr);
  return lin(a, b, n).map((x) => { const y = f(x); return { x, y: fin(y) ? y : null }; });
}
