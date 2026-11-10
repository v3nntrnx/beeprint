import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

// Tiny dependency-free static server for checking the built site locally.
// Run `npm run build` first, or use `npm start` to do both.

const root = resolve(process.cwd(), "dist");
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/vnd.microsoft.icon",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};
const securityHeaders = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "manifest-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

if (!existsSync(root)) {
  console.error("dist/ does not exist. Run `npm run build` first.");
  process.exit(1);
}
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error("PORT must be an integer between 0 and 65535.");
  process.exit(1);
}
const realRoot = realpathSync(root);

function respond(res, status, headers, body = "") {
  res.writeHead(status, { ...securityHeaders, ...headers });
  res.end(body);
}

const server = createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    respond(res, 405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  } catch {
    respond(res, 400, { "Content-Type": "text/plain; charset=utf-8" }, "Bad request");
    return;
  }
  if (pathname.includes("\0")) {
    respond(res, 400, { "Content-Type": "text/plain; charset=utf-8" }, "Bad request");
    return;
  }
  if (pathname.endsWith("/")) pathname += "index.html";

  let file;
  try {
    file = resolve(root, "." + pathname);
  } catch {
    respond(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found");
    return;
  }
  if (file !== realRoot && !file.startsWith(realRoot + sep)) {
    respond(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found");
    return;
  }

  let realFile;
  try {
    realFile = realpathSync(file);
  } catch {
    respond(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found");
    return;
  }
  if (realFile !== realRoot && !realFile.startsWith(realRoot + sep)) {
    respond(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found");
    return;
  }

  let stats;
  try {
    stats = statSync(realFile);
  } catch {
    respond(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found");
    return;
  }
  if (!stats.isFile()) {
    respond(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found");
    return;
  }

  const extension = extname(realFile).toLowerCase();
  const headers = {
    "Content-Type": types[extension] ?? "application/octet-stream",
    "Content-Length": stats.size,
    "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=3600",
  };
  if (req.method === "HEAD") {
    respond(res, 200, headers);
    return;
  }

  res.writeHead(200, { ...securityHeaders, ...headers });
  const stream = createReadStream(realFile);
  stream.on("error", () => {
    if (!res.headersSent) respond(res, 500, { "Content-Type": "text/plain; charset=utf-8" }, "Could not read file");
    else res.destroy();
  });
  stream.pipe(res);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error("Port " + port + " is already in use. Set PORT to another value.");
    process.exit(1);
  }
  throw error;
});

server.listen(port, host, () => {
  console.log("BeePrint preview: http://" + host + ":" + port);
});
