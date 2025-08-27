import express from "express";
import path from "path";

const app = express();
const port = 4000;

app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  next();
});

// serve static files from public/
app.use(express.static(path.resolve("public")));

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
