import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function resolveUrl(url) {
  const cleanPath = decodeURIComponent(new URL(url, `http://localhost:${port}`).pathname);
  const requested = cleanPath === "/" ? "/index.html" : cleanPath;
  const fullPath = path.normalize(path.join(__dirname, requested));
  if (!fullPath.startsWith(__dirname)) {
    return path.join(__dirname, "index.html");
  }
  return fullPath;
}

createServer(async (req, res) => {
  try {
    let fullPath = resolveUrl(req.url);
    const info = await stat(fullPath).catch(() => null);
    if (!info || info.isDirectory()) {
      fullPath = path.join(__dirname, "index.html");
    }

    const body = await readFile(fullPath);
    res.writeHead(200, {
      "Content-Type": types[path.extname(fullPath)] || "application/octet-stream"
    });
    res.end(body);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Local server error: ${error.message}`);
  }
}).listen(port, () => {
  console.log(`Bank Statement ITR Analyzer running at http://localhost:${port}`);
});
