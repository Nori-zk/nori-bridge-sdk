import express from "express";
import path from "path";
import http from "http";
import httpProxy from "http-proxy";

const app = express();
const port = 4002;

// ---- COOP/COEP + no caching ----
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
});

// ---- serve static files ----
app.use(express.static(path.resolve("public")));

// ---- HTTP proxy to Mina devnet ----
const proxy = httpProxy.createProxyServer({
  target: "https://devnet.minaprotocol.network",
  changeOrigin: true,
  ws: true, // enable WebSocket proxying
  secure: true,
});

// Handle HTTP requests to /api/graphql
app.use("/api/graphql", (req, res) => {
  // Add CORS headers for browser
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.sendStatus(204); // preflight

  proxy.web(req, res);
});

// Create HTTP server (needed for WS upgrade)
const server = http.createServer(app);

// Handle WebSocket upgrade for /api/graphql
server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/api/graphql")) {
    proxy.ws(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
