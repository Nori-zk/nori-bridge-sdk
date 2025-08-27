import express from "express";
import path from "path";

const app = express();
const port = 4001;

app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    // disable caching
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
});

// serve static files from public/
app.use(express.static(path.resolve("public")));

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
