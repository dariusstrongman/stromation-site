"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("../live/theater-core.js");
const Truth = require("../live/scene-truth.js");

function event(id, type, seconds, overrides) {
  return {
    id,
    ts: new Date(Date.UTC(2026, 7, 19, 12, 0, seconds)).toISOString(),
    event_type: type,
    headline: `${type} happened in public.`,
    actor: "system",
    ...overrides
  };
}

test("unique role handoffs attach to the matching published worker", () => {
  const events = [
    event(1, "worker_delegated", 1, { headline: "Growth Operator on gpt was given work." }),
    event(2, "worker_delegated", 2, { headline: "Research Worker on qwen was given work." }),
    event(3, "handoff_started", 3, { headline: "Sol handed this to Research Worker: Compare competitors" })
  ];
  const workers = Truth.reconstructWorkers(Core, events, 2).active;
  assert.equal(workers.length, 2);
  assert.equal(workers[0].task, null);
  assert.match(workers[1].task, /Compare competitors/);
});

test("ambiguous completion never guesses which named worker remains active", () => {
  const events = [
    event(1, "worker_delegated", 1, { headline: "Growth Operator on gpt was given work." }),
    event(2, "worker_delegated", 2, { headline: "Research Worker on qwen was given work." }),
    event(3, "worker_completed", 3, { headline: "A worker finished a research pack." })
  ];
  const workers = Truth.reconstructWorkers(Core, events, 1);
  assert.equal(workers.identityAmbiguous, true);
  assert.equal(workers.active.length, 1);
  assert.equal(workers.active[0].role, "Unidentified active worker");
  assert.equal(workers.active[0].publicCountBacked, true);
  assert.equal(workers.outcomes[0].role, "Worker");
});

test("public worker count can add anonymous cards without inventing identity", () => {
  const workers = Truth.reconstructWorkers(Core, [], 2);
  assert.equal(workers.active.length, 2);
  assert.ok(workers.active.every((worker) => worker.role === "Unidentified active worker"));
  assert.ok(workers.active.every((worker) => worker.publicCountBacked === true));
});

test("replay without an exact count keeps only event-backed worker identities", () => {
  const events = [event(1, "worker_delegated", 1, { headline: "Growth Operator on gpt was given work." })];
  const workers = Truth.reconstructWorkers(Core, events, null);
  assert.equal(workers.active.length, 1);
  assert.equal(workers.active[0].role, "Growth Operator");
  assert.equal(workers.active[0].inferred, false);
});

test("conversation grouping adds no second database client and cannot outrun replay", () => {
  const source = fs.readFileSync(path.join(__dirname, "../live/conversation.js"), "utf8");
  assert.doesNotMatch(source, /createClient|\.from\(|SUPABASE_/);
  assert.match(source, /readEvents\(feed\)/);
  assert.match(source, /li\.event:not\(\.event-conversation\)/);
});

test("Live-owned assets use stable /live paths and truth shim loads before renderer", () => {
  const html = fs.readFileSync(path.join(__dirname, "../live/index.html"), "utf8");
  ["live.css", "conversation.css", "theater-core.js", "scene-truth.js", "live.js", "conversation.js"].forEach((asset) => {
    assert.match(html, new RegExp(`[\\"']\\/live\\/${asset.replace(".", "\\.")}[\\"']`));
  });
  assert.ok(html.indexOf("/live/scene-truth.js") < html.indexOf("/live/live.js"));
});

test("viewer labels do not assert unsupported council independence", () => {
  const source = fs.readFileSync(path.join(__dirname, "../live/conversation.js"), "utf8");
  assert.doesNotMatch(source, /Independent review|Council review|In review/i);
  assert.match(source, /Recorded council events/);
});
