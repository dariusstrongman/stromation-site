const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

for (const [file, canonical, target] of [
  ["about.html", "https://www.stromation.com/", "/"],
  ["privacy.html", "https://www.stromation.com/privacy/", "/privacy/"],
  ["terms.html", "https://www.stromation.com/terms/", "/terms/"],
]) {
  test(`${file} is a noindex legacy redirect`, () => {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(html, /<meta\s+name="robots"\s+content="noindex,follow"/i);
    assert.match(html, new RegExp(`<link\\s+rel="canonical"\\s+href="${canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "i"));
    assert.match(html, new RegExp(`http-equiv="refresh"\\s+content="0;\\s*url=${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "i"));
  });
}
