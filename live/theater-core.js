(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StromationTheater = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const EVENT_PRESENTATION = Object.freeze({
    session_started:       { label: "Session opened",     stage: "orient",   tone: "cyan",  sol: "working",    major: true },
    session_completed:     { label: "Session closed",     stage: "decide",   tone: "quiet", sol: "complete",   major: true },
    objective_started:     { label: "Objective started",  stage: "orient",   tone: "cyan",  sol: "working",    major: true },
    objective_completed:   { label: "Objective complete", stage: "decide",   tone: "good",  sol: "reviewing",  major: true },
    handoff_started:       { label: "Handoff",            stage: "delegate", tone: "cyan",  sol: "delegating", major: true },
    worker_delegated:      { label: "Worker delegated",   stage: "delegate", tone: "cyan",  sol: "delegating" },
    worker_started:        { label: "Worker started",     stage: "delegate", tone: "cyan",  sol: "delegating" },
    worker_working:        { label: "Worker working",     stage: "build",    tone: "cyan",  sol: "waiting" },
    worker_completed:      { label: "Worker returned",    stage: "review",   tone: "good",  sol: "reviewing",  major: true },
    worker_failed:         { label: "Worker stopped",     stage: "review",   tone: "bad",   sol: "reviewing",  major: true },
    founder_working:       { label: "Sol working",        stage: "build",    tone: "plain", sol: "working" },
    founder_thinking:      { label: "Sol thinking",       stage: "research", tone: "cyan",  sol: "thinking" },
    research_completed:    { label: "Research complete", stage: "research", tone: "good",  sol: "reviewing" },
    candidate_advanced:    { label: "Candidate advanced",stage: "decide",   tone: "good",  sol: "reviewing",  major: true },
    candidate_rejected:    { label: "Candidate rejected",stage: "decide",   tone: "quiet", sol: "reviewing" },
    decision_summary:      { label: "Decision",           stage: "decide",   tone: "cyan",  sol: "reviewing",  major: true, decision: true },
    build_started:         { label: "Build started",      stage: "build",    tone: "cyan",  sol: "building" },
    build_completed:       { label: "Build complete",     stage: "review",   tone: "good",  sol: "reviewing",  major: true },
    quality_review:        { label: "Quality review",     stage: "review",   tone: "plain", sol: "reviewing" },
    quality_gate_passed:   { label: "Quality accepted",   stage: "review",   tone: "good",  sol: "reviewing",  major: true },
    quality_gate_failed:   { label: "Quality rejected",   stage: "review",   tone: "bad",   sol: "reviewing",  major: true },
    deployment_completed:  { label: "Deployment live",   stage: "publish",  tone: "good",  sol: "reviewing",  major: true, artifact: true },
    deployment_failed:     { label: "Deployment stopped",stage: "publish",  tone: "bad",   sol: "reviewing",  major: true },
    venture_launched:      { label: "Venture launched",  stage: "publish",  tone: "good",  sol: "reviewing",  major: true, artifact: true },
    venture_promoted:      { label: "Venture promoted",  stage: "measure",  tone: "good",  sol: "reviewing",  major: true },
    venture_pivoted:       { label: "Venture pivoted",   stage: "decide",   tone: "cyan",  sol: "reviewing",  major: true },
    venture_retired:       { label: "Venture retired",   stage: "decide",   tone: "quiet", sol: "reviewing",  major: true },
    experiment_started:    { label: "Experiment started",stage: "measure",  tone: "cyan",  sol: "working",    major: true },
    experiment_completed:  { label: "Experiment ended",  stage: "measure",  tone: "good",  sol: "reviewing",  major: true },
    revenue_recorded:      { label: "Revenue recorded",  stage: "measure",  tone: "gold",  sol: "reviewing",  major: true },
    milestone_reached:     { label: "Milestone",         stage: "measure",  tone: "gold",  sol: "reviewing",  major: true },
    escalation_raised:     { label: "Owner needed",      stage: "decide",   tone: "gold",  sol: "waiting",    major: true },
    escalation_resolved:   { label: "Escalation resolved",stage:"decide",   tone: "good",  sol: "working",    major: true },
    company_status:        { label: "Company status",    stage: "orient",   tone: "plain", sol: "working",    major: true },
    council_convened:      { label: "Council convened",  stage: "research", tone: "cyan",  sol: "delegating", major: true },
    council_spoke:         { label: "Council response",  stage: "research", tone: "plain", sol: "reviewing" },
    council_concluded:     { label: "Council concluded", stage: "decide",   tone: "good",  sol: "reviewing",  major: true }
  });

  const PROCESS_STAGES = Object.freeze([
    { id: "orient", label: "Orient" },
    { id: "research", label: "Research" },
    { id: "delegate", label: "Delegate" },
    { id: "build", label: "Build" },
    { id: "review", label: "Review" },
    { id: "publish", label: "Publish" },
    { id: "measure", label: "Measure" },
    { id: "decide", label: "Decide" }
  ]);

  const FALLBACK_PRESENTATION = Object.freeze({
    label: "Public event", stage: "orient", tone: "plain", sol: "working", unknown: true
  });

  function cleanText(value, max) {
    if (value == null) return "";
    return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max || 500);
  }

  function safePublicUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(String(value));
      const host = url.hostname.toLowerCase();
      if (url.protocol !== "https:") return null;
      if (host !== "stromation.com" && host !== "www.stromation.com" && !host.endsWith(".stromation.com")) return null;
      if (url.username || url.password) return null;
      return url.href;
    } catch (_) {
      return null;
    }
  }

  function normalizeEvent(raw) {
    if (!raw || typeof raw !== "object") return null;
    const type = cleanText(raw.event_type, 64) || "unknown";
    const parsed = Date.parse(raw.ts);
    if (!Number.isFinite(parsed)) return null;
    const id = raw.id == null ? `${parsed}-${type}-${cleanText(raw.headline, 24)}` : String(raw.id);
    return {
      id,
      ts: new Date(parsed).toISOString(),
      event_type: type,
      headline: cleanText(raw.headline, 200) || "Public event recorded.",
      summary: cleanText(raw.summary, 500) || null,
      actor: ["sol", "worker", "system", "owner"].includes(raw.actor) ? raw.actor : "system",
      venture: cleanText(raw.venture, 60) || null,
      metric_label: cleanText(raw.metric_label, 40) || null,
      metric_value: cleanText(raw.metric_value, 40) || null,
      link: safePublicUrl(raw.link)
    };
  }

  function eventKey(event) {
    return String(event.id || `${event.ts}|${event.event_type}|${event.headline}`);
  }

  function mergeEvents(existing, incoming) {
    const byId = new Map();
    [...(existing || []), ...(incoming || [])].forEach((raw) => {
      const event = normalizeEvent(raw);
      if (event) byId.set(eventKey(event), event);
    });
    return [...byId.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  }

  function presentationFor(type) {
    return EVENT_PRESENTATION[type] || FALLBACK_PRESENTATION;
  }

  function stateFreshness(publicState, now, thresholdMs) {
    const state = publicState || {};
    if (state.run_state === "paused") return { stale: false, reason: "paused" };
    const heartbeat = Date.parse(state.heartbeat_at);
    if (!Number.isFinite(heartbeat)) return { stale: true, reason: "heartbeat_missing" };
    const ageMs = Math.max(0, Number(now == null ? Date.now() : now) - heartbeat);
    return {
      stale: ageMs > (Number(thresholdMs) || 50 * 60 * 1000),
      reason: ageMs > (Number(thresholdMs) || 50 * 60 * 1000) ? "heartbeat_old" : "fresh",
      ageMs
    };
  }

  function parseWorkerDelegation(event) {
    const match = /^(.+?) on (.+?) was given work\.?$/i.exec(event.headline || "");
    return {
      role: cleanText(match && match[1], 48) || "Worker",
      model: cleanText(match && match[2], 32) || null
    };
  }

  function handoffTask(headline) {
    const match = /^Sol handed this to (.+?):\s*(.+)$/i.exec(headline || "");
    return match ? { role: cleanText(match[1], 48), task: cleanText(match[2], 180) } : null;
  }

  function reconstructWorkers(events, exactCount) {
    const open = [];
    const outcomes = [];
    (events || []).forEach((event) => {
      if (event.event_type === "worker_delegated") {
        const parsed = parseWorkerDelegation(event);
        open.push({
          id: `worker-${event.id}`,
          role: parsed.role,
          model: parsed.model,
          task: null,
          startedAt: event.ts,
          updatedAt: event.ts,
          status: "working",
          sourceEventId: event.id
        });
      } else if (event.event_type === "handoff_started") {
        const handoff = handoffTask(event.headline);
        let worker = handoff && [...open].reverse().find((item) => item.role.toLowerCase() === handoff.role.toLowerCase());
        if (!worker) worker = [...open].reverse().find((item) => !item.task);
        if (worker) {
          worker.task = handoff ? handoff.task : event.headline;
          worker.updatedAt = event.ts;
        }
      } else if (event.event_type === "worker_started" || event.event_type === "worker_working") {
        const worker = open[open.length - 1];
        if (worker) {
          worker.task = event.headline || worker.task;
          worker.updatedAt = event.ts;
        }
      } else if (event.event_type === "worker_completed" || event.event_type === "worker_failed") {
        const worker = open.shift();
        outcomes.unshift({
          ...(worker || { id: `outcome-${event.id}`, role: "Worker", model: null, task: null, startedAt: event.ts }),
          status: event.event_type === "worker_failed" ? "failed" : "completed",
          endedAt: event.ts,
          result: event.headline
        });
      }
    });

    const hasExactCount = exactCount !== null && exactCount !== undefined && exactCount !== "";
    const knownExact = hasExactCount && Number.isFinite(Number(exactCount)) && Number(exactCount) >= 0;
    const target = knownExact ? Number(exactCount) : open.length;
    while (open.length < target) {
      open.push({
        id: `unidentified-${open.length + 1}`,
        role: "Active worker",
        model: null,
        task: "Task summary not published.",
        startedAt: null,
        updatedAt: null,
        status: "working",
        inferred: true
      });
    }
    if (knownExact && open.length > target) open.splice(0, open.length - target);
    return { active: open, outcomes: outcomes.slice(0, 3), exactCount: knownExact ? target : null };
  }

  function activeSessionStart(events) {
    let start = null;
    (events || []).forEach((event) => {
      if (event.event_type === "session_started") start = event;
      if (event.event_type === "session_completed") start = null;
    });
    return start;
  }

  function latestObjective(events, state) {
    if (state && cleanText(state.objective, 160)) return cleanText(state.objective, 160);
    const found = [...(events || [])].reverse().find((event) => event.event_type === "objective_started");
    return found ? found.headline.replace(/^Started:\s*/i, "").replace(/\.$/, "") : "Objective not published";
  }

  function deriveScene(events, publicState, options) {
    const ordered = mergeEvents([], events || []);
    const latest = ordered[ordered.length - 1] || null;
    const config = latest ? presentationFor(latest.event_type) : FALLBACK_PRESENTATION;
    const replay = Boolean(options && options.replay);
    const rawRun = cleanText(publicState && publicState.run_state, 32);
    const runState = replay
      ? (activeSessionStart(ordered) ? "working" : "between_sessions")
      : (["working", "between_sessions", "paused", "offline"].includes(rawRun) ? rawRun : "unknown");
    const sessionStart = activeSessionStart(ordered);
    const workers = reconstructWorkers(ordered, replay ? null : publicState && publicState.workers_active);
    let solState = config.sol;
    if (runState === "paused") solState = "paused";
    else if (runState === "between_sessions") solState = "between_sessions";
    else if (runState === "offline" || runState === "unknown") solState = "unknown";
    return {
      latest,
      stage: config.stage,
      solState,
      runState,
      objective: latestObjective(ordered, replay ? {} : publicState),
      sessionStart: sessionStart && sessionStart.ts,
      workers,
      presentation: config,
      events: ordered
    };
  }

  function sessionTitle(events) {
    const objective = (events || []).find((event) => event.event_type === "objective_started");
    if (objective) return objective.headline.replace(/^Started:\s*/i, "").replace(/\.$/, "").slice(0, 72);
    const rules = [
      ["venture_launched", "Launch session"],
      ["deployment_completed", "Deployment session"],
      ["decision_summary", "Decision session"],
      ["build_started", "Build session"],
      ["research_completed", "Research session"],
      ["worker_delegated", "Delegation session"]
    ];
    for (const [type, label] of rules) if ((events || []).some((event) => event.event_type === type)) return label;
    return "Operating session";
  }

  function groupSessions(events) {
    const ordered = mergeEvents([], events || []);
    const sessions = [];
    let current = null;
    ordered.forEach((event) => {
      if (event.event_type === "session_started") {
        if (current && current.events.length) sessions.push(current);
        current = { id: `session-${event.id}`, startedAt: event.ts, endedAt: null, events: [event] };
      } else if (current) {
        current.events.push(event);
        if (event.event_type === "session_completed") {
          current.endedAt = event.ts;
          sessions.push(current);
          current = null;
        }
      }
    });
    if (current && current.events.length) sessions.push(current);
    return sessions.map((session) => ({
      ...session,
      title: sessionTitle(session.events),
      durationMs: Math.max(0, Date.parse(session.endedAt || session.events[session.events.length - 1].ts) - Date.parse(session.startedAt)),
      majorIndexes: session.events.map((event, index) => presentationFor(event.event_type).major ? index : -1).filter((index) => index >= 0)
    })).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  }

  function createReplayController(options) {
    const clock = options && options.clock ? options.clock : {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id)
    };
    let events = mergeEvents([], options && options.events || []);
    let index = 0;
    let speed = 1;
    let playing = false;
    let timer = null;
    const onFrame = typeof options.onFrame === "function" ? options.onFrame : function () {};
    const onState = typeof options.onState === "function" ? options.onState : function () {};

    function frame() {
      onFrame(events.slice(0, index), index, events.length);
      onState({ playing, index, speed, total: events.length });
    }
    function stopTimer() {
      if (timer != null) clock.clearTimeout(timer);
      timer = null;
    }
    function tick() {
      stopTimer();
      if (!playing) return;
      if (index >= events.length) {
        playing = false;
        frame();
        return;
      }
      index += 1;
      frame();
      timer = clock.setTimeout(tick, Math.max(180, 1200 / speed));
    }
    return {
      play() { if (!playing) { playing = true; frame(); tick(); } },
      pause() { playing = false; stopTimer(); frame(); },
      restart() { playing = false; stopTimer(); index = 0; frame(); },
      seek(next) { index = Math.max(0, Math.min(events.length, Number(next) || 0)); frame(); },
      setSpeed(next) { if ([1, 2, 4].includes(Number(next))) speed = Number(next); frame(); },
      setEvents(next) { playing = false; stopTimer(); events = mergeEvents([], next || []); index = 0; frame(); },
      snapshot() { return { playing, index, speed, total: events.length }; },
      destroy() { playing = false; stopTimer(); }
    };
  }

  return {
    EVENT_PRESENTATION,
    PROCESS_STAGES,
    cleanText,
    safePublicUrl,
    normalizeEvent,
    mergeEvents,
    presentationFor,
    stateFreshness,
    parseWorkerDelegation,
    reconstructWorkers,
    deriveScene,
    groupSessions,
    createReplayController
  };
});
