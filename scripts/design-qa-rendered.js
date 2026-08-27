#!/usr/bin/env node
// design-qa, rendered half: every route is actually opened in Chromium
// at desktop (1440x900) and mobile (390x844). Fails on: render failure,
// JavaScript pageerrors, console errors, failed same-origin requests,
// horizontal overflow at 390px, and axe-core critical/serious WCAG
// 2.1 A/AA violations. Screenshots and a JSON evidence report land in
// artifacts/ for the visual reviewer.
//
// Moderate/minor axe violations and axe "incomplete" results are
// reported, never fatal — they are reviewer evidence (same calibration
// as the venture runtime's render receipts: deterministic checks gate
// what machines can measure, a mind judges the rest).
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");
const { AxeBuilder } = require("@axe-core/playwright");
const { routes, routeFile, root } = require("../tests/routes.js");

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css",
  ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".xml": "text/xml",
  ".txt": "text/plain", ".webp": "image/webp", ".woff2": "font/woff2",
};

function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.normalize(path.join(root, p));
    if (!file.startsWith(root) || !fs.existsSync(file)
        || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, { "content-type":
      MIME[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  return new Promise(ok => srv.listen(0, "127.0.0.1",
    () => ok([srv, srv.address().port])));
}

const VIEWPORTS = [["desktop", 1440, 900], ["mobile", 390, 844]];

(async () => {
  const artifacts = path.join(root, "artifacts");
  const shots = path.join(artifacts, "screenshots");
  fs.mkdirSync(shots, { recursive: true });
  const [srv, port] = await serve();
  const browser = await chromium.launch(
    { args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const report = [];
  let failed = false;

  for (const route of routes) {
    const key = route === "/" ? "home"
      : route.replace(/^\/|\/$/g, "").replace(/\//g, "-");
    const pageDigest = crypto.createHash("sha1")
      .update(fs.readFileSync(routeFile(route))).digest("hex").slice(0, 12);
    for (const [label, width, height] of VIEWPORTS) {
      const entry = { route, key, viewport: `${width}x${height}`,
        page_digest: pageDigest, rendered_at: new Date().toISOString(),
        problems: [], axe_blocking: [], axe_reported: 0, ok: false };
      const ctx = await browser.newContext({
        viewport: { width, height } });
      const page = await ctx.newPage();
      page.on("pageerror", e =>
        entry.problems.push(`pageerror: ${String(e.message).slice(0, 160)}`));
      page.on("console", m => { if (m.type() === "error")
        entry.problems.push(`console: ${m.text().slice(0, 160)}`); });
      page.on("requestfailed", r => { if (r.url().includes("127.0.0.1"))
        entry.problems.push(`request failed: ${r.url().slice(0, 120)}`); });
      try {
        await page.goto(`http://127.0.0.1:${port}${route}`,
          { waitUntil: "load", timeout: 20000 });
        await page.waitForTimeout(1200);
        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth);
        if (overflow && label === "mobile")
          entry.problems.push("horizontal overflow at 390px");
        const shot = path.join(shots, `${key}-${width}.png`);
        await page.screenshot({ path: shot, fullPage: false });
        entry.screenshot = path.relative(root, shot);
        const axe = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        for (const v of axe.violations) {
          if (v.impact === "critical" || v.impact === "serious")
            entry.axe_blocking.push(`${v.impact}: ${v.id} (${v.nodes.length} node(s))`);
          else entry.axe_reported += 1;
        }
        entry.axe_incomplete = axe.incomplete.length;
        entry.ok = entry.problems.length === 0
          && entry.axe_blocking.length === 0;
      } catch (e) {
        entry.problems.push(`render failed: ${String(e.message).slice(0, 200)}`);
      }
      await ctx.close();
      report.push(entry);
      const state = entry.ok ? "ok" : "FAIL";
      console.log(`${state} ${route} @${label}`
        + (entry.problems.length ? ` problems=${JSON.stringify(entry.problems)}` : "")
        + (entry.axe_blocking.length ? ` axe=${JSON.stringify(entry.axe_blocking)}` : ""));
      if (!entry.ok) failed = true;
    }
  }
  await browser.close();
  srv.close();
  fs.writeFileSync(path.join(artifacts, "rendered-qa-report.json"),
    JSON.stringify(report, null, 1));
  console.log(`rendered-qa: ${report.length} render(s), `
    + `${report.filter(r => !r.ok).length} failing `
    + "(evidence: artifacts/rendered-qa-report.json + screenshots/)");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
