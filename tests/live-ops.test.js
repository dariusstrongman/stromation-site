"use strict";

// The operations desk: every visible operational fact comes from the
// published observer block; unknowns stay unknown; private work says
// exactly that. The fixture mirrors a real 2026-08-22 production block.

const test = require("node:test");
const assert = require("node:assert/strict");
const Ops = require("../live/ops-panel.js");

const REAL_BLOCK = {
  schema_version: 1,
  run_state_requested: "running",
  session: { id: "4f9e1345", phase: "closed", turns: 80, cost_usd: 0.26,
             started_at: "2026-08-22T01:25:12+00:00",
             ended_at: "2026-08-22T01:40:02+00:00" },
  delegations: [
    { id: "c983df96", department: "engineering",
      seat: "frontend_engineer", model_family: "qwen", status: "failed",
      failure_category: "missing_deliverable",
      created_at: "2026-08-22T01:37:57+00:00",
      completed_at: "2026-08-22T01:38:23+00:00" },
    { id: "c152b4b6", department: "engineering",
      seat: "frontend_engineer", model_family: "qwen", status: "done",
      created_at: "2026-08-21T20:03:13+00:00",
      completed_at: "2026-08-21T20:04:22+00:00" }
  ],
  grants: [
    { delegation_id: "c983df96", capability: "edit_company_website",
      repo: "stromation-site", branch: "seo/ai-email-followup",
      issued_at: "2026-08-22T01:37:59+00:00",
      revoked_at: "2026-08-22T01:38:23+00:00", active: false }
  ],
  work_item: { pr: 38, repo: "stromation-site", merged: true,
               verdict_head_sha: "20dd7079", deliberation_round: 2,
               gatekeeper_verdict: "PASS" }
};

test("the seven viewer questions are all answerable from one block", () => {
  const vm = Ops.buildViewModel(REAL_BLOCK);
  // which department / which seat / which engine
  assert.equal(vm.delegations[0].department, "engineering");
  assert.equal(vm.delegations[0].seat, "frontend_engineer");
  assert.equal(vm.delegations[0].engine, "qwen");
  // what capability and scope they were given
  assert.equal(vm.grants[0].capability, "edit_company_website");
  assert.equal(vm.grants[0].scope, "stromation-site @ seo/ai-email-followup");
  assert.equal(vm.grants[0].heldSeconds, 24);
  // what the review ruled and what ultimately happened
  assert.equal(vm.workItem.verdict, "PASS");
  assert.equal(vm.workItem.round, 2);
  assert.equal(vm.workItem.merged, true);
  // what stage: merged work item is terminal
  assert.equal(vm.stage, "shipped");
});

test("stage derivation follows proof, not vibes", () => {
  const running = Ops.buildViewModel({ delegations: [
    { id: "x", status: "running" }] });
  assert.equal(running.stage, "executing");
  const credOut = Ops.buildViewModel({ grants: [
    { capability: "edit_company_website", active: true }] });
  assert.equal(credOut.stage, "credential out");
  const inReview = Ops.buildViewModel({ work_item: {
    gatekeeper_verdict: "REVISE", merged: false } });
  assert.equal(inReview.stage, "in review");
  const awaiting = Ops.buildViewModel({ work_item: {
    gatekeeper_verdict: "PASS", merged: false } });
  assert.equal(awaiting.stage, "awaiting merge");
  assert.equal(Ops.buildViewModel({}).stage, null);
});

test("failure categories become plain words, never raw text", () => {
  const vm = Ops.buildViewModel(REAL_BLOCK);
  assert.equal(vm.delegations[0].failure, "deliverable not proven");
  const line = Ops.delegationLine(vm.delegations[0]);
  assert.match(line, /engineering · frontend_engineer seat · qwen engine/);
  assert.match(line, /failed — deliverable not proven/);
});

test("grant lines read as authority, issued and revoked", () => {
  const vm = Ops.buildViewModel(REAL_BLOCK);
  assert.equal(Ops.grantLine(vm.grants[0]),
    "edit_company_website on stromation-site @ seo/ai-email-followup" +
    " — issued and revoked, held 24s");
  const live = Ops.buildViewModel({ grants: [
    { capability: "edit_company_website", repo: "stromation-site",
      branch: "b", active: true }] });
  assert.match(Ops.grantLine(live.grants[0]), /credential ACTIVE$/);
});

test("private work is exactly private — no identity leaks through", () => {
  const vm = Ops.buildViewModel({
    grants: [{ capability: "edit_core", repo: "private", active: true }],
    work_item: { pr: 7, repo: "private", gatekeeper_verdict: "BLOCK" }
  });
  assert.equal(vm.grants[0].scope, "private work");
  assert.equal(vm.workItem.isPrivate, true);
  assert.equal(vm.workItem.repo, null);
  assert.match(Ops.workItemLine(vm), /^private work item — Gatekeeper: BLOCK/);
});

test("unknowns stay unknown: junk and absence render as absence", () => {
  for (const bad of [null, undefined, "not-an-object", 7, []]) {
    const vm = Ops.buildViewModel(bad);
    assert.equal(vm.empty, true);
    assert.equal(vm.stage, null);
  }
  const partial = Ops.buildViewModel({ delegations: [
    { id: "z", status: "exploded-nonsense" },   // unclassifiable: dropped
    { id: "ok", status: "done" }] });
  assert.equal(partial.delegations.length, 1);
  assert.equal(partial.delegations[0].id, "ok");
});

test("the DOM renderer paints the panel and only the panel", () => {
  // minimal document double: enough surface for render()
  const nodes = {};
  const mk = (id) => nodes[id] = { textContent: "", dataset: {},
    children: [], className: "",
    appendChild(c) { this.children.push(c); } };
  ["ops-panel", "ops-stage", "ops-workitem", "ops-delegations",
   "ops-grants", "ops-session"].forEach(mk);
  const doc = {
    getElementById: (id) => nodes[id] || null,
    createElement: () => ({ textContent: "", className: "" })
  };
  Ops.render(doc, REAL_BLOCK);
  assert.equal(nodes["ops-panel"].dataset.stage, "shipped");
  assert.match(nodes["ops-workitem"].textContent,
    /stromation-site · PR #38 — Gatekeeper: PASS · on 20dd7079 · round 2 · MERGED/);
  assert.equal(nodes["ops-delegations"].children.length, 2);
  assert.match(nodes["ops-session"].textContent,
    /Session 4f9e1345 · closed · 80 turns · \$0\.26/);
  // a page without the panel (stale cache) is a clean no-op
  Ops.render({ getElementById: () => null,
               createElement: () => ({}) }, REAL_BLOCK);
});
