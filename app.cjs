const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;

const routes = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/assets/app.js": { file: "public/assets/app.js", type: "text/javascript; charset=utf-8" },
  "/assets/styles.css": { file: "public/assets/styles.css", type: "text/css; charset=utf-8" }
};

function sendFile(res, route) {
  const target = path.join(root, route.file);
  fs.readFile(target, (error, body) => {
    if (error) {
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end("Unable to load application file.");
      return;
    }

    res.statusCode = 200;
    res.setHeader("content-type", route.type);
    res.setHeader("cache-control", "public, max-age=0, must-revalidate");
    res.end(body);
  });
}

module.exports = (req, res) => {
  const url = new URL(req.url || "/", "https://bank-statement-itr-analyzer.vercel.app");
  const route = routes[url.pathname] || routes["/"];
  sendFile(res, route);
};
