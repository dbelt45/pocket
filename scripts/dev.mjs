// Run Pocket on this laptop the way Vercel runs it: files from public/, and
// anything under /api handled by the matching file in api/. `npm run dev`.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json" };
const root = fileURLToPath(new URL("..", import.meta.url));

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
  try {
    if (url.pathname.startsWith("/api/")) {
      const mod = await import(pathToFileURL(join(root, `${url.pathname}.js`)).href);
      return await mod.default(req, res);
    }
    const file = normalize(join(root, "public", url.pathname === "/" ? "index.html" : url.pathname));
    if (!file.startsWith(join(root, "public"))) return res.status(403).end();
    res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ERR_MODULE_NOT_FOUND") return res.status(404).end("Not found");
    console.error(e); res.status(500).json({ ok: false, message: e.message });
  }
}).listen(3001, () => console.log("Pocket on http://localhost:3001"));
