// The single source of truth for the site's routes. site.test.js asserts
// against this list and the design-qa scripts render it; adding a page
// means adding it here (and to sitemap.xml, which the tests cross-check).
const path = require("path");

const root = path.resolve(__dirname, "..");

const routes = [
  "/", "/workers/", "/operations-employee/", "/custom/", "/how-it-works/",
  "/live/", "/privacy/", "/terms/", "/technology/", "/governance/",
  "/resources/automate-business-operations/",
  "/resources/ai-inbox-management/",
  "/resources/ai-vs-virtual-assistant/",
  "/resources/ai-email-followup/",
  "/resources/ai-sales-followup/",
  "/resources/ai-operations-employee-in-action/",
  "/resources/automate-business-inbox/",
  "/resources/"
];

function routeFile(route) {
  return route === "/" ? path.join(root, "index.html")
    : path.join(root, route, "index.html");
}

module.exports = { routes, routeFile, root };
