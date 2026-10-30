import { check, compile, THEOREMS, fmt } from "/core.mjs";

const $ = (id) => document.getElementById(id);
const st = { th: "ivt", assume: {}, found: new Set(), info: null, last: null, marks: [] };
const params = {};
const SHORT = { ivt: "Intermediate Value", rolle: "Rolle", evt: "Extreme Value" };

function resetAssume() { st.assume = Object.fromEntries(THEOREMS[st.th].assumptions.map((a) => [a.id, true])); }
function loadParams(src) {
  Object.assign(params, { expr: src.expr, a: String(src.a), b: String(src.b), y: String(src.y ?? 0.5), closedA: src.closedA !== false, closedB: src.closedB !== false });
  $("expr").value = params.expr; $("pa").value = params.a; $("pb").value = params.b; $("py").value = params.y;
  $("ca").checked = params.closedA; $("cb").checked = params.closedB;
}
function readParams() {
  Object.assign(params, { expr: $("expr").value, a: $("pa").value, b: $("pb").value, y: $("py").value, closedA: $("ca").checked, closedB: $("cb").checked });
}

function buildCabinets() {
  $("cabinets").replaceChildren(...Object.keys(THEOREMS).map((id) => {
    const b = document.createElement("button"); b.textContent = SHORT[id]; b.setAttribute("aria-pressed", id === st.th);
    b.onclick = () => selectTheorem(id); return b;
  }));
}
function selectTheorem(id) {
  st.th = id; resetAssume(); loadParams(THEOREMS[id].defaults); $("attempts").replaceChildren();
  $("nemstatus").className = "nemstatus"; $("nemstatus").textContent = "Drop an assumption, then let the model try. The checker decides if it counts.";
  buildCabinets(); buildSwitches(); buildLevels(); $("statement").textContent = THEOREMS[id].statement;
  $("ly").hidden = id !== "ivt"; $("ends").hidden = id !== "evt"; run();
}
function buildSwitches() {
  const th = THEOREMS[st.th];
  $("switches").replaceChildren(...th.assumptions.map((a) => {
    const li = document.createElement("li"), lab = document.createElement("label");
    lab.className = "sw" + (st.assume[a.id] ? "" : " off");
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = st.assume[a.id];
    cb.onchange = () => { st.assume[a.id] = cb.checked; buildSwitches(); run(); };
    const knob = document.createElement("i"), t = document.createElement("span"); t.textContent = a.label;
    lab.append(cb, knob, t);
    if (st.info?.necessity?.[st.th]?.find((m) => m.id === a.id)?.necessary) { const e = document.createElement("em"); e.textContent = st.found.has(st.th + a.id) ? "cracked" : "needed"; lab.append(e); }
    li.append(lab); return li;
  }));
}
function buildLevels() {
  const L = (st.info?.library || []).filter((l) => l.th === st.th);
  $("levels").replaceChildren(...L.map((l) => {
    const li = document.createElement("li"), b = document.createElement("button");
    const a = THEOREMS[st.th].assumptions.find((x) => x.id === l.drop);
    b.className = st.found.has(st.th + l.drop) ? "done" : "";
    b.innerHTML = ""; b.append("Break: " + a.label); const s = document.createElement("small"); s.textContent = l.note; b.append(s);
    b.onclick = () => { st.assume = Object.fromEntries(THEOREMS[st.th].assumptions.map((x) => [x.id, x.id !== l.drop])); loadParams(l); buildSwitches(); run(); };
    li.append(b); return li;
  }));
}

function num(v) { const t = String(v).trim().toLowerCase(); return t === "inf" ? Infinity : Number(t); }
function run() {
  readParams();
  const input = { expr: params.expr, a: num(params.a), b: num(params.b), y: num(params.y), closedA: params.closedA, closedB: params.closedB };
  const v = check(st.th, input, st.assume); st.last = v;
  const box = $("verdict"); box.className = "verdict " + v.status;
  const title = { counterexample: "COUNTEREXAMPLE", holds: "THEOREM HOLDS", rejected: "NOT ALLOWED", error: "CHECK INPUT" }[v.status];
  box.replaceChildren(); const b = document.createElement("b"); b.textContent = title; const p = document.createElement("div"); p.textContent = v.message; box.append(b, p);
  if (v.hypotheses) {
    const ul = document.createElement("ul"); ul.className = "hyp";
    for (const h of v.hypotheses) { const li = document.createElement("li"); const s = document.createElement("span"); s.className = h.holds ? "ok" : "no"; s.textContent = h.holds ? "✓ " : "✗ "; li.append(s, h.label + (h.assumed ? "" : " (dropped)") + " — " + h.detail); ul.append(li); }
    box.append(ul);
  }
  if (v.status === "counterexample") { for (const id of v.broken) if (v.hypotheses.filter((h) => !h.holds).length === 1) st.found.add(st.th + id); updateScore(); buildLevels(); }
  draw(input, v);
}
function updateScore() {
  const total = Object.values(THEOREMS).reduce((n, t) => n + t.assumptions.length, 0);
  $("score").textContent = "CRACKED " + st.found.size + "/" + total;
}

function draw(input, v) {
  const c = $("plot"), g = c.getContext("2d"), W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  const a = input.a, b = Number.isFinite(input.b) ? input.b : input.a + 10;
  if (!(Number.isFinite(a) && b > a)) return;
  let f; try { f = compile(input.expr); } catch { return; }
  const pts = []; for (let k = 0; k <= 900; k++) { const x = a + ((b - a) * k) / 900, y = f(x); pts.push([x, Number.isFinite(y) ? y : null]); }
  const ys = pts.map((q) => q[1]).filter((y) => y !== null && Math.abs(y) < 1e6);
  let lo = Math.min(...ys, st.th === "ivt" ? input.y : 0, 0), hi = Math.max(...ys, st.th === "ivt" ? input.y : 0, 0);
  if (!ys.length) return; if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const clipLo = Math.max(lo, -50), clipHi = Math.min(hi, 50); lo = clipLo; hi = clipHi;
  const padY = (hi - lo) * 0.12; lo -= padY; hi += padY;
  const m = 44, X = (x) => m + ((x - a) / (b - a)) * (W - 2 * m), Y = (y) => H - m - ((y - lo) / (hi - lo)) * (H - 2 * m);
  g.font = "13px ui-monospace,Menlo,monospace"; g.lineWidth = 1;
  g.strokeStyle = "#243044"; g.fillStyle = "#93a1b8";
  if (lo < 0 && hi > 0) { g.beginPath(); g.moveTo(m, Y(0)); g.lineTo(W - m, Y(0)); g.stroke(); }
  g.fillText(fmt(a), m, H - 14); g.fillText(Number.isFinite(input.b) ? fmt(input.b) : "→ ∞", W - m - 24, H - 14);
  g.fillText(fmt(hi - padY), 4, m); g.fillText(fmt(lo + padY), 4, H - m);
  if (st.th === "ivt" && Number.isFinite(input.y)) { g.strokeStyle = "#ffc24b"; g.setLineDash([6, 6]); g.beginPath(); g.moveTo(m, Y(input.y)); g.lineTo(W - m, Y(input.y)); g.stroke(); g.setLineDash([]); g.fillStyle = "#ffc24b"; g.fillText("y = " + fmt(input.y), W - m - 90, Y(input.y) - 6); }
  for (const h of v.hypotheses || []) for (const x of h.marks || []) { if (x >= a && x <= b) { g.strokeStyle = "#ff6b7a"; g.setLineDash([3, 5]); g.beginPath(); g.moveTo(X(x), m); g.lineTo(X(x), H - m); g.stroke(); g.setLineDash([]); } }
  g.strokeStyle = "#7dff8a"; g.lineWidth = 2.5; g.shadowColor = "#7dff8a"; g.shadowBlur = 8;
  let open = false; g.beginPath();
  let prev = null;
  for (const [x, y] of pts) {
    if (y === null || y < lo - 1 || y > hi + 1) { open = false; prev = null; continue; }
    if (prev !== null && Math.abs(y - prev) > (hi - lo) * 0.5) open = false;
    if (!open) { g.moveTo(X(x), Y(y)); open = true; } else g.lineTo(X(x), Y(y));
    prev = y;
  }
  g.stroke(); g.shadowBlur = 0;
  if (st.th === "evt") for (const [x, ok] of [[a, input.closedA], [b, input.closedB]]) { if (!Number.isFinite(x) || x === Infinity) continue; const y = f(x); if (!Number.isFinite(y)) continue; g.lineWidth = 2; g.strokeStyle = "#e6edf7"; g.fillStyle = ok ? "#e6edf7" : "#0b0e14"; g.beginPath(); g.arc(X(x), Y(y), 6, 0, 7); g.fill(); g.stroke(); }
  const w = v.conclusion?.witness;
  if (w && Number.isFinite(w.y)) { g.fillStyle = "#5fd7ff"; g.beginPath(); g.arc(X(w.x), Y(w.y), 7, 0, 7); g.fill(); g.fillText("witness x≈" + fmt(w.x), X(w.x) + 10, Y(w.y) - 10); }
}

async function ask() {
  const btn = $("ask"), s = $("nemstatus"), ol = $("attempts");
  readParams();
  if (!Object.values(st.assume).includes(false)) { s.className = "nemstatus bad"; s.textContent = "Switch off at least one assumption first."; return; }
  btn.disabled = true; s.className = "nemstatus"; s.textContent = "Nemotron is thinking… (proposals are checked, up to 3 tries)"; ol.replaceChildren();
  try {
    const r = await fetch("/api/propose", { method: "POST", body: JSON.stringify({ theorem: st.th, assume: st.assume, params: { a: num(params.a), b: num(params.b), y: num(params.y), closedA: params.closedA, closedB: params.closedB } }) });
    const j = await r.json();
    if (!r.ok) { s.className = "nemstatus bad"; s.textContent = j.error; return; }
    for (const at of j.attempts) {
      const li = document.createElement("li");
      li.textContent = at.error ? "unusable reply: " + at.error : "f(x) = " + at.proposal.expr + " → checker: " + at.verdict.status + (at.verdict.status === "counterexample" ? "" : " (" + at.verdict.message.slice(0, 90) + "…)");
      ol.append(li);
    }
    if (j.accepted) {
      const p = j.proposal.input; loadParams({ expr: p.expr, a: p.a, b: p.b, y: p.y, closedA: p.closedA, closedB: p.closedB });
      s.className = "nemstatus good"; s.textContent = "Accepted: " + j.model.split("/")[1] + " proposed f(x) = " + p.expr + (j.proposal.why ? ". Its reasoning: " + j.proposal.why : "");
      run();
    } else { s.className = "nemstatus bad"; s.textContent = "Nemotron's proposals did not pass the checker. Nothing was accepted; try again or change the switches."; }
  } catch (e) { s.className = "nemstatus bad"; s.textContent = "Request failed: " + e.message; }
  finally { btn.disabled = false; }
}

$("ask").onclick = ask;
$("fn").addEventListener("input", run);
$("fn").addEventListener("submit", (e) => e.preventDefault());
st.info = await (await fetch("/api/info")).json();
updateScore(); selectTheorem("ivt");
if (!st.info.live) { $("nemstatus").textContent = "Server has no NEBIUS_API_KEY: Nemotron is off. Levels and manual play still work."; }
