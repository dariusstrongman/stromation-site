#!/usr/bin/env node
// design-qa, static half: markup validity + anti-slop detection + copy
// hygiene on every route. Deterministic; non-zero exit fails the
// required check. The rendered half is scripts/design-qa-rendered.js.
//
// Gate calibration (Phase 1, docs in the Stromation runtime repo under
// docs/quality/WEBSITE_QUALITY_STANDARD.md):
//   - html-validate: errors fail (config in .htmlvalidate.json; two aria
//     rules are warn-only until legacy pages are cleaned up).
//   - impeccable detect: severity "error" fails; warnings and advisory
//     findings are written to artifacts/impeccable-report.json as
//     reviewer evidence, never as failures (taste is judged by the
//     reviewer, not a regex).
//   - copy: unresolved template artifacts and unambiguous AI-slop
//     phrases fail; em dashes and softer wording are reported only
//     (80 em dashes ship on legacy pages; the house no-em-dash rule
//     applies to new copy via review, not retroactive gate-redding).
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { routes, routeFile, root } = require("../tests/routes.js");

const files = routes.map(routeFile);
const artifacts = path.join(root, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
let failed = false;

// ---------------------------------------------------------------- 1. markup
try {
  execFileSync(path.join(root, "node_modules", ".bin", "html-validate"),
    files, { cwd: root, stdio: "inherit" });
  console.log("html-validate: clean");
} catch (e) {
  console.error("html-validate: FAIL");
  failed = true;
}

// ---------------------------------------------------------------- 2. detector
let findings = [];
try {
  const out = execFileSync(
    path.join(root, "node_modules", ".bin", "impeccable"),
    ["detect", "--json", ...files],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  findings = JSON.parse(out || "[]");
} catch (e) {
  // exit 2 = findings (stdout still carries the JSON); exit 1 = engine
  // error, which fails closed.
  if (e.status === 2 && e.stdout) {
    try { findings = JSON.parse(e.stdout); } catch {
      console.error("impeccable: unparseable findings output"); failed = true;
    }
  } else {
    console.error("impeccable: engine error", String(e.message || e).slice(0, 300));
    failed = true;
  }
}
const errors = findings.filter(f => f.severity === "error");
fs.writeFileSync(path.join(artifacts, "impeccable-report.json"),
  JSON.stringify(findings, null, 1));
console.log(`impeccable: ${findings.length} finding(s), `
  + `${errors.length} error-severity (report: artifacts/impeccable-report.json)`);
for (const f of errors) {
  console.error(`  ERROR ${f.antipattern} ${path.relative(root, f.file || "")} — ${f.snippet || f.name}`);
  failed = true;
}

// ---------------------------------------------------------------- 3. copy
const visible = (html) => html
  .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<[^>]+>/g, " ");

const BANNED = [           // unambiguous slop or unfinished work: FAIL
  /lorem ipsum/i, /\{\{[^}]*\}\}/, /\{%[^%]*%\}/,
  /\bTODO\b/, /\bFIXME\b/, /\bPLACEHOLDER\b/,
  /unlock the power/i, /revolutioni[sz]e your/i, /seamlessly integrate/i,
  /in today's fast-paced/i, /game.chang(er|ing)/i, /supercharge your/i,
  /unleash the/i, /take your business to the next level/i,
  /elevate your (business|workflow)/i,
];
const REPORTED = [          // house-style debt on legacy pages: report only
  { name: "em dash in copy", re: /—/ },
  { name: "cutting-edge", re: /cutting.edge/i },
  { name: "best-in-class", re: /best.in.class/i },
];
const copyReport = [];
for (const f of files) {
  const text = visible(fs.readFileSync(f, "utf8"));
  const rel = path.relative(root, f);
  for (const re of BANNED) {
    const m = text.match(re);
    if (m) { console.error(`copy: FAIL ${rel} — banned pattern ${re} ("${m[0].slice(0, 60)}")`); failed = true; }
  }
  for (const { name, re } of REPORTED) {
    const hits = (text.match(new RegExp(re, re.flags.includes("g") ? re.flags : re.flags + "g")) || []).length;
    if (hits) copyReport.push({ file: rel, issue: name, hits });
  }
}
fs.writeFileSync(path.join(artifacts, "copy-report.json"),
  JSON.stringify(copyReport, null, 1));
console.log(`copy: ${copyReport.length} reported item(s) (artifacts/copy-report.json)`);

process.exit(failed ? 1 : 0);
