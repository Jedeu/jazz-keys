// Optional local preview. Node built-ins only; nothing to install.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const types = { html: "text/html", css: "text/css", js: "text/javascript", webmanifest: "application/manifest+json", svg: "image/svg+xml", png: "image/png" };
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const publicFile = /^(index\.html|styles\.css|manifest\.webmanifest|sw\.js|src\/(app|audio|chords|input)\.js|icons\/(icon\.svg|icon-(192|512)\.png|apple-touch-icon\.png))$/;

createServer(async (request, response) => {
  try {
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const path = pathname === "/" ? "index.html" : pathname.slice(1);
    if (!publicFile.test(path)) {
      response.writeHead(404).end("Not found");
      return;
    }
    const data = await readFile(fileURLToPath(new URL(path, root)));
    response.writeHead(200, {
      "Content-Type": types[path.split(".").at(-1)],
      "Content-Length": data.length,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : data);
  } catch {
    response.writeHead(400).end("Unable to serve this request");
  }
}).listen(port, host, () => {
  console.log(`Jazz Keys: http://${host}:${port}`);
  console.log("Use an HTTPS host for offline installation on your iPad. See README.md.");
});
