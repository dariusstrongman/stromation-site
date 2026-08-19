"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("../live/theater-core.js");
const root = path.resolve(__dirname, "..");

function event(id, type, seconds, overrides) {
  return {
    id,
    ts: new Date(Date.UTC(2026, 7, 16, 12, 0, seconds)).toISOString(),
    event_type: type,
    headline: `${type} happened in public.`,
    actor: "system",
    ...overrides
  };
}

test("realtime insertion merges, sorts, and ignores duplicates", () => {
  const first = event(1, "session_started", 1);
  const second = event(2, "founder_working", 2);
  const merged = Core.mergeEvents([second], [first, second]);
  assert.deepEqual(merged.map((item) => item.id), ["1", "2"]);
});

test("public state update changes the scene without fabricating missing fields", () => {
  const events = [event(1, "session_started", 1)];
  const scene = Core.deriveScene(events, { run_state: "working", objective: "Audit the live company", workers_active: 0 });
  assert.equal(scene.runState, "working");
  assert.equal(scene.objective, "Audit the live company");
  assert.equal(scene.workers.active.length, 0);
});

test("connection failure and stale state are distinguishable", () => {
  assert.deepEqual(Core.stateFreshness({}, Date.UTC(2026, 7, 16, 14)), { stale: true, reason: "heartbeat_missing" });
  const heartbeat = new Date(Date.UTC(2026, 7, 16, 12)).toISOString();
  assert.equal(Core.stateFreshness({ run_state: "working", heartbeat_at: heartbeat }, Date.UTC(2026, 7, 16, 13), 30 * 60 * 1000).stale, true);
  assert.equal(Core.stateFreshness({ run_state: "paused", heartbeat_at: heartbeat }, Date.UTC(2026, 7, 20), 1).reason, "paused");
});

test("events are ordered chronologically even when loaded newest first", () => {
  const ordered = Core.mergeEvents([], [event(3, "session_completed", 3), event(1, "session_started", 1), event(2, "founder_working", 2)]);
  assert.deepEqual(ordered.map((item) => item.id), ["1", "2", "3"]);
});

test("parallel workers remain distinct until real completion events arrive", () => {
  const events = [
    event(1, "worker_delegated", 1, { headline: "Growth Operator on gpt was given work.", actor: "sol" }),
    event(2, "handoff_started", 2, { headline: "Sol handed this to Growth Operator: Research AI directories", actor: "sol" }),
    event(3, "worker_delegated", 3, { headline: "Research Worker on qwen was given work.", actor: "sol" }),
    event(4, "handoff_started", 4, { headline: "Sol handed this to Research Worker: Compare competitors", actor: "sol" })
  ];
  const workers = Core.reconstructWorkers(events, 2).active;
  assert.equal(workers.length, 2);
  assert.deepEqual(workers.map((worker) => worker.role), ["Growth Operator", "Research Worker"]);
  assert.match(workers[0].task, /directories/);
  assert.match(workers[1].task, /competitors/);
});

test("replay does not coerce an unavailable historical worker count to zero", () => {
  const events = [event(1, "worker_delegated", 1, { headline: "Growth Operator on gpt was given work." })];
  assert.equal(Core.reconstructWorkers(events, null).active.length, 1);
  assert.equal(Core.deriveScene(events, {}, { replay: true }).workers.active.length, 1);
});

test("worker completion and failure remove only published active slots", () => {
  const base = [
    event(1, "worker_delegated", 1, { headline: "Growth Operator on gpt was given work." }),
    event(2, "worker_delegated", 2, { headline: "QA Worker on qwen was given work." })
  ];
  const completed = Core.reconstructWorkers([...base, event(3, "worker_completed", 3)], 1);
  assert.equal(completed.active.length, 1);
  assert.equal(completed.outcomes[0].status, "completed");
  const failed = Core.reconstructWorkers([...base, event(4, "worker_failed", 4)], 1);
  assert.equal(failed.outcomes[0].status, "failed");
});

test("session start, end, and idle state are honest", () => {
  const start = event(1, "session_started", 1);
  assert.equal(Core.deriveScene([start], { run_state: "working" }).sessionStart, start.ts);
  const ended = Core.deriveScene([start, event(2, "session_completed", 5)], { run_state: "between_sessions" });
  assert.equal(ended.sessionStart, null);
  assert.equal(ended.runState, "between_sessions");
  assert.equal(ended.solState, "between_sessions");
});

test("unknown event types use a safe generic presentation", () => {
  const unknown = Core.presentationFor("future_event_type");
  assert.equal(unknown.label, "Public event");
  assert.equal(unknown.unknown, true);
  assert.doesNotThrow(() => Core.deriveScene([event(1, "future_event_type", 1)], { run_state: "working" }));
});

test("missing and malformed events fail safely", () => {
  assert.equal(Core.normalizeEvent(null), null);
  assert.equal(Core.normalizeEvent({ event_type: "session_started", ts: "not-a-date" }), null);
  const missing = Core.normalizeEvent({ id: 1, event_type: "company_status", ts: "2026-08-16T12:00:00Z" });
  assert.equal(missing.headline, "Public event recorded.");
});

test("replay groups real events and preserves chronological order", () => {
  const events = [
    event(5, "session_completed", 5),
    event(1, "session_started", 1),
    event(3, "decision_summary", 3),
    event(8, "session_completed", 8),
    event(6, "session_started", 6)
  ];
  const sessions = Core.groupSessions(events);
  assert.equal(sessions.length, 2);
  assert.deepEqual(sessions[1].events.map((item) => item.id), ["1", "3", "5"]);
  assert.deepEqual(sessions[0].events.map((item) => item.id), ["6", "8"]);
});

test("replay never relabels an old session with the current live objective", () => {
  const scene = Core.deriveScene(
    [event(1, "session_started", 1)],
    { run_state: "working", objective: "A different live objective" },
    { replay: true }
  );
  assert.equal(scene.objective, "Objective not published");
});

test("replay can pause, resume, seek, restart, and change speed", () => {
  let queue = [];
  let nextId = 0;
  const clock = {
    setTimeout(fn, ms) { const id = ++nextId; queue.push({ id, fn, ms }); return id; },
    clearTimeout(id) { queue = queue.filter((item) => item.id !== id); }
  };
  const frames = [];
  const replay = Core.createReplayController({ events: [event(1, "session_started", 1), event(2, "session_completed", 2)], clock, onFrame: (_, index) => frames.push(index) });
  replay.setSpeed(4);
  replay.play();
  assert.equal(replay.snapshot().playing, true);
  assert.equal(replay.snapshot().index, 1);
  assert.equal(queue[0].ms, 300);
  replay.pause();
  assert.equal(queue.length, 0);
  replay.seek(2);
  assert.equal(replay.snapshot().index, 2);
  replay.restart();
  assert.equal(replay.snapshot().index, 0);
  replay.play();
  assert.ok(frames.length >= 4);
});

test("every current public event class has intentional presentation", () => {
  const expected = [
    "session_started", "session_completed", "objective_started", "objective_completed",
    "handoff_started", "worker_delegated", "worker_started", "worker_working",
    "worker_completed", "worker_failed", "founder_working", "founder_thinking",
    "research_completed", "candidate_advanced", "candidate_rejected", "decision_summary",
    "build_started", "build_completed", "quality_review", "quality_gate_passed",
    "quality_gate_failed", "deployment_completed", "deployment_failed", "venture_launched",
    "venture_promoted", "venture_pivoted", "venture_retired", "experiment_started",
    "experiment_completed", "revenue_recorded", "milestone_reached", "escalation_raised",
    "escalation_resolved", "company_status", "council_convened", "council_spoke", "council_concluded"
  ];
  assert.deepEqual(Object.keys(Core.EVENT_PRESENTATION).sort(), expected.sort());
});

test("text and public artifact links are bounded against XSS and open redirects", () => {
  const normalized = Core.normalizeEvent({
    id: 1,
    ts: "2026-08-16T12:00:00Z",
    event_type: "deployment_completed",
    headline: "<img src=x onerror=alert(1)>",
    summary: "\u0000safe",
    actor: "system",
    link: "javascript:alert(1)"
  });
  assert.equal(normalized.link, null);
  assert.equal(normalized.headline, "<img src=x onerror=alert(1)>");
  assert.equal(normalized.summary, "safe");
  assert.equal(Core.safePublicUrl("https://evil.example/?next=stromation.com"), null);
  assert.equal(Core.safePublicUrl("https://llmcost.stromation.com/path"), "https://llmcost.stromation.com/path");
});

test("browser client references only the two approved public tables", () => {
  const source = fs.readFileSync(path.join(__dirname, "../live/live.js"), "utf8");
  assert.match(source, /\["public_state", "public_events"\]/);
  const forbidden = ["events", "wakeups", "journal", "memory", "tasks", "ledger", "employees", "delegations", "company"];
  forbidden.forEach((table) => {
    assert.doesNotMatch(source, new RegExp(`\\.from\\(["']${table}["']\\)`));
  });
});

test("completed worker outcomes survive into the scene for rendering", () => {
  const events = [
    { id: 1, ts: "2026-08-19T04:33:31Z", event_type: "worker_delegated",
      headline: "Evidence Researcher on gpt was given work." },
    { id: 2, ts: "2026-08-19T04:33:32Z", event_type: "handoff_started",
      headline: "Sol handed this to Evidence Researcher: Find which AI tool directories accept submissions" },
    { id: 3, ts: "2026-08-19T04:35:56Z", event_type: "worker_completed",
      headline: "A worker finished a evidence pack." }
  ];
  const workers = Core.reconstructWorkers(events, 0);
  assert.equal(workers.active.length, 0);
  assert.equal(workers.outcomes.length, 1);
  const job = workers.outcomes[0];
  assert.equal(job.status, "completed");
  assert.match(job.role, /Evidence Researcher/i);
  assert.ok(job.task && job.task.includes("directories"),
    "the outcome keeps the task so viewers see WHAT the department did");
});

test("the live page renders recent delegated work, not only active desks", () => {
  const js = fs.readFileSync(path.join(root, "live", "live.js"), "utf8");
  assert.match(js, /renderOutcomes/);
  assert.match(js, /scene\.workers\.outcomes/);
  const css = fs.readFileSync(path.join(root, "live", "live.css"), "utf8");
  assert.match(css, /worker-card-done/);
  assert.match(css, /\.event\[data-tone="cyan"\]/);
});
