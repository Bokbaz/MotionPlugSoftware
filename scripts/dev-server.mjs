import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.env.PORT ?? 4173);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".jpg": "image/jpeg", ".mp4": "video/mp4", ".wav": "audio/wav", ".png": "image/png" };

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? "/", `http://${request.headers.host}`).pathname);
  const requested = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!requested.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end("Forbidden"); return; }
  try {
    const info = await stat(requested);
    const file = info.isDirectory() ? path.join(requested, "index.html") : requested;
    response.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`Motion Plug preview: http://127.0.0.1:${port}`));
