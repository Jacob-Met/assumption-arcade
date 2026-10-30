import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { check, necessityMap, THEOREMS, LIBRARY } from "./public/core.mjs";
import { proposeCounterexample, MODEL } from "./nemotron.mjs";

const PUB = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

export function makeServer(opts = {}) {
  return createServer(async (req, res) => {
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    try {
      const url = new URL(req.url, "http://x");
      if (req.method === "GET" && url.pathname === "/api/info")
        return send(200, { model: MODEL, live: !!(opts.apiKey ?? process.env.NEBIUS_API_KEY), theorems: THEOREMS, library: LIBRARY, necessity: Object.fromEntries(Object.keys(THEOREMS).map((t) => [t, necessityMap(t)])) });
      if (req.method === "POST" && (url.pathname === "/api/check" || url.pathname === "/api/propose")) {
        let body = "";
        for await (const c of req) { body += c; if (body.length > 20000) return send(413, { error: "too large" }); }
        const j = JSON.parse(body || "{}");
        if (!THEOREMS[j.theorem]) return send(400, { error: "unknown theorem" });
        if (url.pathname === "/api/check") return send(200, check(j.theorem, j.params || {}, j.assume));
        try { return send(200, await (opts.propose || proposeCounterexample)(j, opts)); }
        catch (e) { return send(e.code === "NO_KEY" ? 503 : 502, { error: e.message }); }
      }
      if (req.method !== "GET") return send(405, { error: "method" });
      const p = url.pathname === "/" ? "/index.html" : normalize(url.pathname);
      if (p.includes("..")) return send(400, { error: "bad path" });
      const data = await readFile(join(PUB, p));
      res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
      res.end(data);
    } catch (e) {
      if (e.code === "ENOENT") return send(404, { error: "not found" });
      send(400, { error: e.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 4416;
  makeServer().listen(port, () => console.log(`Assumption Arcade on http://localhost:${port}  (Nemotron: ${process.env.NEBIUS_API_KEY ? "key set" : "NEBIUS_API_KEY not set"})`));
}
