import test from "node:test";
import assert from "node:assert/strict";
import { check, compile, necessityMap, THEOREMS, LIBRARY } from "../public/core.mjs";
import { buildMessages, parseProposal, proposeCounterexample, callNemotron } from "../nemotron.mjs";
import { makeServer } from "../server.mjs";

const drop = (th, id) => Object.fromEntries(THEOREMS[th].assumptions.map((a) => [a.id, a.id !== id]));

test("parser evaluates and refuses unsafe input", () => {
  assert.equal(compile("2*x^2+1")(3), 19);
  assert.equal(compile("if(x<0.5,-1,1)")(0.2), -1);
  assert.throws(() => compile("process.exit()"));
  assert.throws(() => compile("a+"));
});

test("every curated counterexample is accepted by the checker", () => {
  for (const l of LIBRARY) assert.equal(check(l.th, l, drop(l.th, l.drop)).status, "counterexample", l.th + " " + l.expr);
});

test("a counterexample that breaks a kept assumption is rejected", () => {
  assert.equal(check("rolle", { expr: "abs(x)", a: -1, b: 1 }).status, "rejected");
});

test("holds when theorem applies; all nine assumptions are necessary", () => {
  assert.equal(check("ivt", { expr: "x", a: 0, b: 1, y: 0.5 }).status, "holds");
  for (const t of Object.keys(THEOREMS)) for (const m of necessityMap(t)) assert.ok(m.necessary, t + " " + m.id);
});

test("prompt mentions kept and dropped hypotheses, parser tolerates fences", () => {
  const m = buildMessages({ theorem: "rolle", assume: drop("rolle", "differentiable"), params: { a: -1, b: 1 } });
  assert.match(m[1].content, /KEEPS[^\n]*continuous/);
  assert.match(m[1].content, /DROPPED[^\n]*differentiable/);
  const p = parseProposal('```json\n{"expr":"abs(x)","a":-1,"b":"1","why":"corner"}\n```');
  assert.deepEqual([p.expr, p.a, p.b], ["abs(x)", -1, 1]);
  assert.throws(() => parseProposal("no json"));
});

const fakeFetch = (replies) => { let i = 0; return async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: replies[Math.min(i++, replies.length - 1)] } }] }) }); };

test("adapter: bad first proposal is repaired, only verified one is accepted (no network)", async () => {
  const r = await proposeCounterexample({ theorem: "rolle", assume: drop("rolle", "differentiable"), params: { a: -1, b: 1 } },
    { apiKey: "test", fetchImpl: fakeFetch(['{"expr":"x^2","a":-1,"b":1}', '{"expr":"abs(x)","a":-1,"b":1,"why":"corner at 0"}']) });
  assert.equal(r.accepted, true);
  assert.equal(r.attempts.length, 2);
  assert.equal(r.attempts[0].verdict.status, "holds");
  assert.equal(r.verdict.status, "counterexample");
});

test("adapter: never accepts a model claim the checker rejects", async () => {
  const r = await proposeCounterexample({ theorem: "ivt", assume: drop("ivt", "continuous"), params: { a: 0, b: 1, y: 0.5 } },
    { apiKey: "test", tries: 2, fetchImpl: fakeFetch(['{"expr":"x","a":0,"b":1,"y":0.5}']) });
  assert.equal(r.accepted, false);
});

test("adapter: missing key gives a clear error", async () => {
  await assert.rejects(callNemotron([], { apiKey: "" }), /NEBIUS_API_KEY/);
});

test("server: check API, propose without key -> 503, static files", async () => {
  const s = makeServer({ apiKey: "" }); await new Promise((r) => s.listen(0, r));
  const base = "http://localhost:" + s.address().port;
  const prev = process.env.NEBIUS_API_KEY; delete process.env.NEBIUS_API_KEY;
  try {
    const c = await (await fetch(base + "/api/check", { method: "POST", body: JSON.stringify({ theorem: "ivt", params: { expr: "x", a: 0, b: 1, y: 0.5 } }) })).json();
    assert.equal(c.status, "holds");
    const p = await fetch(base + "/api/propose", { method: "POST", body: JSON.stringify({ theorem: "rolle", assume: drop("rolle", "equal"), params: { a: 0, b: 1 } }) });
    assert.equal(p.status, 503);
    assert.match((await p.json()).error, /NEBIUS_API_KEY/);
    assert.equal((await fetch(base + "/")).status, 200);
    assert.equal((await fetch(base + "/../server.mjs")).status, 404);
  } finally { if (prev) process.env.NEBIUS_API_KEY = prev; s.close(); }
});
