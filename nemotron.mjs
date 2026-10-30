// Nemotron on Nebius Token Factory: proposes counterexample functions. The app's own checker (public/core.mjs) verifies them.
import { check, THEOREMS } from "./public/core.mjs";

export const BASE_URL = process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1";
export const MODEL = process.env.NEBIUS_MODEL || "nvidia/nemotron-3-super-120b-a12b";

const SYNTAX = "Expression syntax: variable x; numbers; + - * / ^; parentheses; functions sin cos tan atan abs sqrt cbrt exp ln floor ceil round sign sinh cosh tanh min max pow mod; constants pi e; comparisons < > <= >= == != give 1 or 0; if(cond, then, else) is allowed, e.g. if(x<0.5, -1, 1). Division by zero gives infinity.";

export function buildMessages({ theorem, assume, params, feedback }) {
  const th = THEOREMS[theorem];
  const kept = th.assumptions.filter((a) => assume[a.id] !== false).map((a) => a.label);
  const dropped = th.assumptions.filter((a) => assume[a.id] === false).map((a) => a.label);
  const sys = "You are a careful real-analysis tutor who builds counterexamples. Reply with ONE JSON object and nothing else, no markdown.";
  let user = `Theorem: ${th.name}. ${th.statement}\nConclusion to defeat: ${th.conclusionText}.\n` +
    `Hypotheses the player KEEPS (your function must satisfy every one): ${kept.length ? kept.join("; ") : "none"}.\n` +
    `Hypotheses the player DROPPED (your function must violate at least one): ${dropped.join("; ")}.\n` +
    `Current setup: a=${params.a}, b=${params.b}` + (theorem === "ivt" ? `, y=${params.y}` : "") +
    (theorem === "evt" ? `, interval ${params.closedA === false ? "(" : "["}a, b${params.closedB === false ? ")" : "]"}` : "") + ".\n" +
    "You may change a, b" + (theorem === "ivt" ? ", y" : "") + (theorem === "evt" ? ", closedA, closedB (booleans; b may be \"inf\")" : "") + " if that helps.\n" + SYNTAX + "\n" +
    'Return JSON: {"expr": string, "a": number, "b": number' + (theorem === "ivt" ? ', "y": number' : "") + (theorem === "evt" ? ', "closedA": boolean, "closedB": boolean' : "") + ', "why": one sentence on why the conclusion fails}.';
  if (feedback) user += `\nYour previous attempt was rejected by a numerical checker: ${feedback}\nFix it and answer again.`;
  return [{ role: "system", content: sys }, { role: "user", content: user }];
}

export function parseProposal(text) {
  if (typeof text !== "string") throw new Error("empty model reply");
  const t = text.replace(/```(?:json)?/gi, "");
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("no JSON object in model reply");
  const o = JSON.parse(t.slice(s, e + 1));
  if (typeof o.expr !== "string" || !o.expr.trim()) throw new Error("proposal has no expr");
  const n = (v) => (typeof v === "string" && v.trim().toLowerCase() === "inf" ? Infinity : typeof v === "string" ? Number(v) : v);
  return { expr: o.expr.trim(), a: n(o.a), b: n(o.b), y: n(o.y), closedA: o.closedA, closedB: o.closedB, why: typeof o.why === "string" ? o.why.slice(0, 400) : "" };
}

export async function callNemotron(messages, { apiKey = process.env.NEBIUS_API_KEY, fetchImpl = fetch, model = MODEL, baseUrl = BASE_URL } = {}) {
  if (!apiKey) { const e = new Error("NEBIUS_API_KEY is not set on the server. Set it and restart to use Nemotron."); e.code = "NO_KEY"; throw e; }
  const r = await fetchImpl(baseUrl + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
    body: JSON.stringify({ model, messages, max_tokens: 3000, temperature: 0.4 }),
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) throw new Error("Token Factory returned HTTP " + r.status);
  const j = await r.json();
  return j.choices?.[0]?.message?.content ?? "";
}

const brief = (v) => ({ status: v.status, message: v.message, hypotheses: v.hypotheses, conclusion: v.conclusion, params: v.params, broken: v.broken });

// propose -> verify -> (feedback -> repair), up to `tries` times. Only a checker-confirmed counterexample is accepted.
export async function proposeCounterexample({ theorem, assume, params }, opts = {}) {
  const th = THEOREMS[theorem];
  if (!th) throw new Error("unknown theorem");
  assume = Object.fromEntries(th.assumptions.map((a) => [a.id, !(assume && assume[a.id] === false)]));
  if (!Object.values(assume).includes(false)) throw new Error("Switch off at least one assumption first.");
  const tries = opts.tries || 3, attempts = [];
  let feedback = null;
  for (let k = 0; k < tries; k++) {
    let proposal, verdict;
    try {
      const text = await callNemotron(buildMessages({ theorem, assume, params, feedback }), opts);
      proposal = parseProposal(text);
      const input = { ...params, expr: proposal.expr };
      for (const key of ["a", "b", "y", "closedA", "closedB"]) if (proposal[key] !== undefined && proposal[key] !== null && !Number.isNaN(proposal[key])) input[key] = proposal[key];
      proposal.input = input;
      verdict = check(theorem, input, assume);
    } catch (e) {
      if (e.code === "NO_KEY") throw e;
      attempts.push({ error: e.message });
      feedback = "reply could not be used: " + e.message;
      continue;
    }
    attempts.push({ proposal, verdict: brief(verdict) });
    if (verdict.status === "counterexample") return { accepted: true, model: opts.model || MODEL, attempts, proposal, verdict };
    feedback = verdict.message;
  }
  return { accepted: false, model: opts.model || MODEL, attempts };
}
