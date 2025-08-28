import express from 'express';
import path from 'path';
import http from 'http';
import httpProxy from 'http-proxy';

const app = express();
const port = 4003;

// COOP/COEP + no caching
app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate'
    );
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
});

// Serve static files
app.use(express.static(path.resolve('public')));

// HTTP + WS proxy to Mina devnet
const proxy = httpProxy.createProxyServer({
    //target: 'https://devnet.minaprotocol.network',
    changeOrigin: true,
    ws: true, // enable WebSocket proxying
    secure: true,
});

// Handle HTTP requests to /api/graphql
/*app.use("/graphql", (req, res) => {
  // Add CORS headers for browser
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.sendStatus(204); // preflight

  proxy.web(req, res);
});*/
// Proxy for pcs.nori.it.com
app.use('/converted-consensus-mpt-proofs', (req, res) => {
    proxy.web(req, res, {
      target: 'https://pcs.nori.it.com/converted-consensus-mpt-proofs',
    });
});

// Catch-all proxy for Mina devnet
app.use((req, res) => {
    proxy.web(req, res, {
        target: 'https://devnet.minaprotocol.network',
    });
});

// Create HTTP server (needed for WS upgrade)
const server = http.createServer(app);

// Handle WebSocket upgrade for /api/graphql
/*server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/graphql")) {
    proxy.ws(req, socket, head);
  } else {
    socket.destroy();
  }
});*/
server.on('upgrade', (req, socket, head) => {
    console.log('Upgrade attempt detected:', req.url);
    proxy.ws(req, socket, head);
});

server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
