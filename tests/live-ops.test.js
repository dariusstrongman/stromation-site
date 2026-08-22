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
  // present tense stays empty: everything in this block is finished
  assert.deepEqual(vm.now,
    { delegation: null, authority: false, joined: false });
});

test("the now-line speaks only from provably current signals", () => {
  const running = Ops.buildViewModel({ delegations: [
    { id: "x", status: "running" }] });
  assert.deepEqual(running.now,
    { delegation: "executing", authority: false, joined: false });
  assert.equal(Ops.nowLine(running), "Now · executing");
  const queued = Ops.buildViewModel({ delegations: [
    { id: "x", status: "pending" }] });
  assert.equal(queued.now.delegation, "queued");
  assert.equal(Ops.nowLine(Ops.buildViewModel({})),
    "Now · no hand-off or credential is active");
});

test("an old merged work item never overrides a running delegation",
  () => {
    // the pre-fix bug: merged had priority, so an ANCIENT shipped item
    // next to fresh live work claimed the whole company was 'shipped'
    const vm = Ops.buildViewModel({
      work_item: { pr: 1, repo: "stromation-site", merged: true,
                   gatekeeper_verdict: "PASS" },
      delegations: [{ id: "fresh", status: "running",
                      department: "engineering" }]
    });
    assert.equal(vm.now.delegation, "executing");
    const line = Ops.nowLine(vm);
    assert.ok(!/shipped/i.test(line), line);
    assert.match(Ops.workItemLine(vm), /^Latest reviewed work: /);
  });

test("terminal delegations claim no current stage at all", () => {
  const done = Ops.buildViewModel({ delegations: [
    { id: "a", status: "done" }] });
  assert.equal(done.now.delegation, null);
  assert.equal(Ops.nowLine(done),
    "Now · no hand-off or credential is active");
  const failed = Ops.buildViewModel({ delegations: [
    { id: "b", status: "failed", failure_category: "other" }] });
  assert.equal(failed.now.delegation, null);
  assert.ok(!/handed off/i.test(Ops.nowLine(failed)));
});

test("an active grant asserts authority only — never review state",
  () => {
    const vm = Ops.buildViewModel({
      grants: [{ capability: "edit_company_website",
                 repo: "stromation-site", branch: "b", active: true }],
      work_item: { pr: 9, repo: "stromation-site",
                   gatekeeper_verdict: "BLOCK", merged: false }
    });
    assert.equal(Ops.nowLine(vm), "Now · credential out");
    // the BLOCK stays where it belongs: on the labeled latest review
    assert.match(Ops.workItemLine(vm),
      /^Latest reviewed work: .*Gatekeeper: BLOCK/);
  });

test("correlation is claimed only through the shared durable id", () => {
  const joined = Ops.buildViewModel({
    delegations: [{ id: "abc12345", status: "running" }],
    grants: [{ capability: "edit_company_website", active: true,
               delegation_id: "abc12345" }]
  });
  assert.equal(joined.now.joined, true);
  assert.equal(Ops.nowLine(joined),
    "Now · executing under a live credential");
  const unrelated = Ops.buildViewModel({
    delegations: [{ id: "abc12345", status: "running" }],
    grants: [{ capability: "edit_company_website", active: true,
               delegation_id: "zzz99999" }]
  });
  assert.equal(unrelated.now.joined, false);
  assert.equal(Ops.nowLine(unrelated), "Now · executing · credential out");
});

test("mixed unrelated records stay independently truthful", () => {
  const vm = Ops.buildViewModel({
    delegations: [{ id: "old1", status: "failed",
                    failure_category: "routing_refused" },
                  { id: "old2", status: "done" }],
    grants: [{ capability: "edit_company_website",
               repo: "stromation-site", branch: "x",
               issued_at: "2026-08-22T01:00:00Z",
               revoked_at: "2026-08-22T01:00:30Z", active: false }],
    work_item: { pr: 38, repo: "stromation-site", merged: true,
                 gatekeeper_verdict: "PASS" }
  });
  assert.equal(Ops.nowLine(vm),
    "Now · no hand-off or credential is active");
  assert.match(Ops.workItemLine(vm), /MERGED/);
  assert.match(Ops.grantLine(vm.grants[0]), /issued and revoked, held 30s/);
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
  assert.match(Ops.workItemLine(vm),
    /^Latest reviewed work: private work item — Gatekeeper: BLOCK/);
});

test("unknowns stay unknown: junk and absence render as absence", () => {
  for (const bad of [null, undefined, "not-an-object", 7, []]) {
    const vm = Ops.buildViewModel(bad);
    assert.equal(vm.empty, true);
    assert.equal(vm.now.delegation, null);
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
  assert.equal(nodes["ops-panel"].dataset.now, "idle");
  assert.equal(nodes["ops-stage"].textContent,
    "Now · no hand-off or credential is active");
  assert.match(nodes["ops-workitem"].textContent,
    /^Latest reviewed work: stromation-site · PR #38 — Gatekeeper: PASS · on 20dd7079 · round 2 · MERGED/);
  assert.equal(nodes["ops-delegations"].children.length, 2);
  assert.match(nodes["ops-session"].textContent,
    /Session 4f9e1345 · closed · 80 turns · \$0\.26/);
  // a page without the panel (stale cache) is a clean no-op
  Ops.render({ getElementById: () => null,
               createElement: () => ({}) }, REAL_BLOCK);
});
