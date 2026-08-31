const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { routes, routeFile, root } = require("./routes.js");

function readRoute(route) {
  return fs.readFileSync(routeFile(route), "utf8");
}

function stripQuery(value) {
  return value.split("?")[0].split("#")[0];
}

test("every intended public route exists with launch metadata and one H1", () => {
  for (const route of routes) {
    const file = routeFile(route);
    assert.equal(fs.existsSync(file), true, `${route} is missing`);
    const html = readRoute(route);
    assert.equal((html.match(/<h1\b/gi) || []).length, 1, `${route} must have one H1`);
    assert.match(html, /<title>[^<]+<\/title>/i, `${route} title`);
    assert.match(html, /<meta\s+name="description"\s+content="[^"]+"/i, `${route} description`);
    assert.match(html, /<link\s+rel="canonical"\s+href="https:\/\/www\.stromation\.com\//i, `${route} canonical`);
    const socialImage = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
    assert.ok(socialImage, `${route} social image`);
    const imagePath = new URL(socialImage[1]).pathname;
    assert.equal(fs.existsSync(path.join(root, imagePath)), true, `${route} social image file`);
  }
});

test("internal page links and fragments resolve", () => {
  for (const route of routes) {
    const html = readRoute(route);
    const hrefs = [...html.matchAll(/<a\b[^>]*\shref="([^"]+)"/gi)].map((match) => match[1]);
    for (const href of hrefs) {
      if (/^(?:https?:|mailto:|tel:)/i.test(href)) continue;
      const [rawPath, fragment] = href.split("#");
      let targetRoute = stripQuery(rawPath || route);
      if (!targetRoute.startsWith("/")) continue;
      if (!targetRoute.endsWith("/") && !path.extname(targetRoute)) targetRoute += "/";
      const target = targetRoute === "/" ? path.join(root, "index.html") : path.join(root, targetRoute, "index.html");
      assert.equal(fs.existsSync(target), true, `${route} links to missing ${href}`);
      if (fragment) {
        const targetHtml = fs.readFileSync(target, "utf8");
        const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        assert.match(targetHtml, new RegExp(`\\bid=["']${escaped}["']`, "i"), `${route} links to missing fragment ${href}`);
      }
    }
  }
});

test("structured data is valid JSON", () => {
  for (const route of routes) {
    const html = readRoute(route);
    const blocks = [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
    for (const [, source] of blocks) assert.doesNotThrow(() => JSON.parse(source), `${route} JSON-LD`);
  }
});

test("sitemap contains every intended route exactly once", () => {
  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  const found = [...sitemap.matchAll(/<loc>https:\/\/www\.stromation\.com([^<]*)<\/loc>/g)]
    .map((match) => match[1] || "/");
  assert.deepEqual(found.sort(), [...routes].sort());
});

// THE SHELL IS A CONTRACT, AND IT APPLIES TO EVERY ROUTE.
// Three tests further down already pin pieces of it — and each names the
// HOMEPAGE specifically, because that is the page that had drifted when
// they were written. On 2026-08-24 a new page drifted the same way in a
// different direction: /resources/inbox-roi-calculator/ shipped with its
// own inline stylesheet, its own palette and width, no shared header nav,
// and NO analytics of any kind — invisible to GA4, on a page whose whole
// job is conversion. Every required check passed, because nothing asked
// "does this page belong to this site?".
//
// So the shell is asserted per ROUTE. Fixing it page by page just waits
// for the next page.
//
// Two documented exceptions, both narrow and both still measured:
//   /       renders its own CSS (see the shared-header test below) and
//           measures with an inline gtag snippet instead of the shared
//           script — deliberate for the landing page.
//   /live/  is the observatory: its own stylesheets and its own chrome.
const SELF_STYLED = new Set(["/", "/live/"]);
const OWN_CHROME = new Set(["/live/"]);
const GA4_ID = "G-0VDWHMS6MW";

test("every route is measured", () => {
  for (const route of routes) {
    const html = readRoute(route);
    const shared = /src="\/assets\/analytics\.js/.test(html);
    const inline = html.includes(GA4_ID);
    assert.ok(shared || inline,
      `${route} loads neither /assets/analytics.js nor an inline ${GA4_ID} ` +
      "snippet — it is invisible to analytics");
  }
});

test("every route uses the shared stylesheet", () => {
  for (const route of routes) {
    if (SELF_STYLED.has(route)) continue;
    assert.match(readRoute(route), /href="\/assets\/site\.css/,
      `${route} does not link the shared stylesheet — a page with its own ` +
      "inline design system stops inheriting sitewide changes");
  }
});

test("every route carries the shared header navigation", () => {
  for (const route of routes) {
    if (OWN_CHROME.has(route)) continue;
    const html = readRoute(route);
    assert.match(html, /<header class="site-header">/, `${route} header`);
    assert.match(html, /<nav id="site-nav" class="site-nav"/, `${route} nav`);
    assert.match(html, /class="nav-cta"/,
      `${route} has no header CTA — every page must offer a way to buy`);
  }
});

test("every route carries a footer", () => {
  for (const route of routes) {
    assert.match(readRoute(route), /<footer/, `${route} has no footer`);
  }
});

test("the retired Growth Operator page redirects to the flagship", () => {
  const html = fs.readFileSync(path.join(root, "growth-operator", "index.html"), "utf8");
  assert.match(html, /meta name="robots" content="noindex"/i);
  assert.match(html, /http-equiv="refresh" content="0;url=\/operations-employee\/"/i);
  assert.match(html, /rel="canonical" href="https:\/\/www\.stromation\.com\/operations-employee\/"/i);
  assert.equal(html.includes("Growth Operator"), true, "growth-operator redirects to operations-employee");
});

test("only approved offers and prices appear anywhere", () => {
  const source = routes.map(readRoute).join("\n");
  assert.doesNotMatch(source, /\$99\b/, "the retired $99 offer resurfaced");
  assert.doesNotMatch(source, /first ten customers/i);
  assert.doesNotMatch(source, /Operations Worker/, "coming-soon shadow of the flagship");
  assert.doesNotMatch(source, /Custom AI Worker\b/);
  // Repriced HIGH TICKET by owner decision 2026-08-31 — human-led sale.
  assert.match(readRoute("/operations-employee/"), /\$1,000 setup \+ \$1,250 per month/);
  assert.match(readRoute("/"), /\$1,000 setup \+ \$1,250 per month/);
  assert.match(readRoute("/custom/"), /Starting at \$1,500 setup \+ \$1,500\/month/i);
  // bare figures stay allowed — competitor citations legitimately quote
  // their own prices (Keap at $299/mo). The guard bans the OLD OFFER
  // phrasings, which is what resurfacing would actually look like.
  assert.doesNotMatch(source, /\$199\s*(?:\/|per\s)?mo|\$250 (?:setup|one-time)|\$299\/month/i,
    "pre-pivot pricing resurfaced");
  assert.doesNotMatch(source, /founding pilot/i, "pilot framing resurfaced");
  // event-driven honesty: never imply continuous inference
  assert.match(readRoute("/operations-employee/"), /wakes when work arrives/i);
  // authority split stated
  assert.match(readRoute("/operations-employee/"), /Requires your approval/);
});

test("legacy watch URLs keep intentional redirects", () => {
  for (const name of ["index.html", "office.html", "replay.html", "story.html", "watch.html"]) {
    const html = fs.readFileSync(path.join(root, "watch", name), "utf8");
    assert.match(html, /http-equiv="refresh"/i, `watch/${name}`);
    assert.match(html, /content="0;url=\/(?:live\/)?"/i, `watch/${name}`);
  }
  assert.match(fs.readFileSync(path.join(root, "robots.txt"), "utf8"), /Disallow:\s*\/watch\//);
});

test("Live keeps its real public feed and stable page heading", () => {
  const html = readRoute("/live/");
  const js = fs.readFileSync(path.join(root, "live", "live.js"), "utf8");
  assert.match(html, /<h1\s+id="live-title">Stromation Live<\/h1>/);
  assert.match(html, /<h2\s+id="objective-title">Objective not published<\/h2>/);
  assert.match(js, /PUBLIC_TABLES\s*=\s*Object\.freeze\(\["public_state", "public_events"\]\)/);
  assert.match(js, /\.from\(PUBLIC_TABLES\[0\]\)/);
  assert.match(js, /\.from\(PUBLIC_TABLES\[1\]\)/);
  assert.match(js, /subscribe\(/);
});

test("public offer copy avoids fabricated proof and retired products", () => {
  const source = routes.map(readRoute).join("\n");
  assert.doesNotMatch(source, /testimonial|trusted by|customers include|guaranteed ROI/i);
  assert.doesNotMatch(source, /BidEngine|ContractReview|PolicyBot|ConvertAPI|ResumeGo/i);
  assert.match(readRoute("/workers/"), /Not yet available/i);
});

test("early access uses the approved FormSubmit intake and discloses it", () => {
  const home = readRoute("/");
  assert.match(home, /<form\s+id="early-access-form"[^>]+action="https:\/\/formsubmit\.co\/ajax\/sol@stromation\.com"[^>]+method="POST"/i);
  for (const name of ["name", "email", "company", "intent", "recurring_work", "_honey"]) {
    assert.match(home, new RegExp(`\\bname=["']${name}["']`, "i"), `missing form field ${name}`);
  }
  assert.match(home, /<option value="operations">AI Operations Employee<\/option>/);
  assert.match(home, /<option value="custom">Custom AI Employee<\/option>/);
  assert.match(home, /<option value="other">Something Else<\/option>/);
  const contact = home.match(/<section id="contact"[\s\S]*?<\/section>/i)[0];
  assert.doesNotMatch(contact, /mailto:/i);
  const privacy = readRoute("/privacy/");
  assert.match(privacy, /FormSubmit/);
  assert.match(privacy, /retains form submissions for 30 days/i);
});

test("favicon links end cleanly — no stray markup after them", () => {
  for (const route of routes) {
    const html = readRoute(route);
    // any favicon link must be immediately followed by a tag open or
    // whitespace, never by leftover SVG fragments or a
    // dangling quote
    for (const m of html.matchAll(/rel="icon"[^>]*>([^\n<]{0,80})/gi)) {
      assert.equal(m[1].trim(), "", `${route} has stray markup after the favicon: ${m[1].slice(0, 60)}`);
    }
    assert.doesNotMatch(html, /svg\+xml"><rect/i, `
      ${route} has stray SVG rect in favicon
    `);
  }
});

test("every route lacks the noindex robots directive", () => {
  for (const route of routes) {
    const html = readRoute(route);
    assert.doesNotMatch(html, /name="robots".*content="[^"]*noindex/i, `${route} has noindex`);
  }
});

test("the homepage header is the shared implementation, not its own", () => {
  // it renders its own CSS (it does not load site.css), but the markup,
  // classes and toggle must be the canonical ones or the menu bar reads
  // as a different site on the page most visitors land on first
  const html = readRoute("/");
  assert.match(html, /<header class="site-header">/);
  assert.match(html, /<nav id="site-nav" class="site-nav"/);
  assert.match(html, /class="brand" href="\/"/);
  assert.match(html, /class="nav-toggle"[^>]*aria-controls="site-nav"/);
  assert.match(html, /class="nav-cta"/);
  for (const stale of [/class="mast"/, /id="home-nav"/, /home-nav-toggle/,
                       /class="mark"/]) {
    assert.doesNotMatch(html, stale, `homepage still carries ${stale}`);
  }
});

test("one script drives the mobile nav on every page", () => {
  // site.js binds .nav-toggle/.site-nav; a second inline handler on the
  // same elements toggles the menu twice per tap
  const html = readRoute("/");
  assert.match(html, /assets\/site\.js/);
  assert.doesNotMatch(html, /querySelector\('\.home-nav-toggle'\)/);
});

test("the homepage grid is the sitewide grid", () => {
  // the header matched in markup but sat on a narrower container:
  // site.css draws content at min(100% - pad*2, --max) while the
  // homepage draws at --w minus its own 24px padding. Desktop content
  // widths must be equal or the shared header visibly misaligns.
  const home = readRoute("/");
  const css = fs.readFileSync(path.join(root, "assets", "site.css"), "utf8");
  const w = Number(home.match(/--w:\s*(\d+)px/)[1]);
  const pad = Number(home.match(/--pad:\s*(\d+)px/)[1]);
  const max = Number(css.match(/--max:\s*(\d+)px/)[1]);
  assert.equal(w - pad * 2, max,
    `homepage content width ${w - pad * 2} != sitewide ${max}`);
});
