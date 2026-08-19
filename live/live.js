(function () {
  "use strict";

  const Core = window.StromationTheater;
  const SUPABASE_URL = "https://oushyhkmekemygzxvabh.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91c2h5aGttZWtlbXlnenh2YWJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMTM0NDAsImV4cCI6MjEwMTY4OTQ0MH0.bvm3rJF6rY6_tL3Ra_AJgd0b3vkajt4J0Fs8MjhsvTg";
  const PUBLIC_TABLES = Object.freeze(["public_state", "public_events"]);
  const MAX_HISTORY = 500;
  const el = (id) => document.getElementById(id);

  const app = {
    mode: "live",
    publicState: null,
    events: [],
    sessions: [],
    selectedSession: null,
    replayEvents: [],
    realtimeStatus: "connecting",
    fetchedAt: null,
    eventPulseId: null,
    client: null,
    channel: null,
    timer: null,
    replay: null
  };

  const RUN_LABELS = {
    working: "Working now",
    between_sessions: "Between sessions",
    paused: "Paused by the owner",
    offline: "Runtime offline",
    unknown: "Status unknown"
  };
  const SOL_LABELS = {
    working: "Working",
    thinking: "Thinking",
    delegating: "Delegating",
    reviewing: "Reviewing",
    building: "Building",
    waiting: "Waiting",
    complete: "Closing session",
    paused: "Paused",
    between_sessions: "Between sessions",
    unknown: "State unknown"
  };

  function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text != null) item.textContent = text;
    return item;
  }

  function known(value) {
    return value !== null && value !== undefined && value !== "";
  }

  function money(value) {
    if (!known(value) || !Number.isFinite(Number(value))) return "Unknown";
    const amount = Number(value);
    return amount.toLocaleString("en-US", {
      style: "currency", currency: "USD",
      minimumFractionDigits: Math.abs(amount) < 1000 ? 2 : 0,
      maximumFractionDigits: Math.abs(amount) < 1000 ? 2 : 0
    });
  }

  function count(value) {
    if (!known(value) || !Number.isFinite(Number(value))) return "Unknown";
    return Number(value).toLocaleString("en-US");
  }

  function shortTime(value) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return "Time unknown";
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(parsed);
  }

  function longDate(value) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return "Date unknown";
    return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(parsed);
  }

  function dayLabel(value) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return "Date unknown";
    return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(parsed);
  }

  function duration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "Duration unknown";
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remain = seconds % 60;
    if (hours) return `${hours}h ${minutes}m ${remain}s`;
    return `${minutes}m ${String(remain).padStart(2, "0")}s`;
  }

  function ago(value) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return "time unknown";
    const delta = Math.max(0, Date.now() - parsed);
    const minutes = Math.floor(delta / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  function currentEvents() {
    return app.mode === "replay" ? app.replayEvents : app.events;
  }

  function currentScene() {
    return Core.deriveScene(currentEvents(), app.publicState || {}, { replay: app.mode === "replay" });
  }

  function setMetric(id, value) {
    const target = el(id);
    target.textContent = value;
    target.classList.toggle("is-unknown", value === "Unknown");
  }

  function renderProcess(activeStage) {
    const track = el("process-track");
    track.replaceChildren();
    Core.PROCESS_STAGES.forEach((stage) => {
      const item = node("li", stage.id === activeStage ? "is-active" : "", stage.label);
      if (stage.id === activeStage) item.setAttribute("aria-current", "step");
      track.append(item);
    });
  }

  function drawSprite(sprite) {
    const canvas = el("sol-sprite");
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#071012";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!sprite || !Array.isArray(sprite.grid) || !Array.isArray(sprite.palette)) {
      ctx.strokeStyle = "#00e5ff";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(64, 45, 22, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(33, 111); ctx.quadraticCurveTo(64, 76, 95, 111); ctx.stroke();
      return;
    }
    const rows = sprite.grid.length;
    const cols = Math.max(...sprite.grid.map((row) => Array.isArray(row) ? row.length : 0));
    if (!rows || !cols) return;
    const cell = Math.floor(Math.min(canvas.width / cols, canvas.height / rows));
    const offsetX = Math.floor((canvas.width - cols * cell) / 2);
    const offsetY = Math.floor((canvas.height - rows * cell) / 2);
    sprite.grid.forEach((row, y) => {
      if (!Array.isArray(row)) return;
      row.forEach((value, x) => {
        if (!value) return;
        const color = sprite.palette[Number(value) - 1];
        if (!color) return;
        ctx.fillStyle = color;
        ctx.fillRect(offsetX + x * cell, offsetY + y * cell, cell, cell);
      });
    });
  }

  function timeOfDay(iso) {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (err) {
      return "unknown";
    }
  }

  function renderOutcomes(stage, outcomes) {
    if (!outcomes || !outcomes.length) return;
    const head = node("div", "worker-outcomes-head", "Recent delegated work");
    stage.append(head);
    outcomes.forEach((job) => {
      const card = node("article", "worker-card worker-card-done");
      const top = node("div", "worker-top");
      top.append(
        node("h4", "", job.role || "Worker"),
        node("span", `worker-status worker-status-${job.status}`, job.status === "failed" ? "Failed" : "Delivered")
      );
      card.append(top);
      card.append(node("p", "", job.task || job.result || "Task summary not published."));
      const meta = node("div", "worker-meta");
      meta.append(node("span", "", job.model ? `Model · ${job.model}` : "Model · unknown"));
      meta.append(node("span", "", job.endedAt ? `Finished · ${timeOfDay(job.endedAt)}` : "Finished · unknown"));
      card.append(meta);
      stage.append(card);
    });
  }

  function renderWorkers(scene) {
    const stage = el("worker-stage");
    stage.replaceChildren();
    const workers = scene.workers.active;
    const outcomes = scene.workers.outcomes || [];
    const shownCount = scene.workers.exactCount == null ? workers.length : scene.workers.exactCount;
    el("worker-count").textContent = shownCount === 0 ? "0 active" : `${shownCount} active`;
    if (!workers.length) {
      if (outcomes.length) {
        renderOutcomes(stage, outcomes);
        return;
      }
      const empty = node("div", "worker-empty");
      const wrap = node("div");
      wrap.append(node("span", "", "Desks available"), node("strong", "", "Workers appear only while real delegations are active."));
      empty.append(wrap);
      stage.append(empty);
      return;
    }
    workers.forEach((worker) => {
      const card = node("article", "worker-card");
      const top = node("div", "worker-top");
      top.append(node("h4", "", worker.role || "Active worker"), node("span", "worker-status", "Working"));
      card.append(top);
      card.append(node("p", "", worker.task || "Task summary not published."));
      const meta = node("div", "worker-meta");
      meta.append(node("span", "", worker.model ? `Model · ${worker.model}` : "Model · unknown"));
      meta.append(node("span", "", worker.startedAt ? `Elapsed · ${duration(Date.now() - Date.parse(worker.startedAt))}` : "Elapsed · unknown"));
      meta.append(node("span", "", "Cost · unknown"));
      card.append(meta);
      stage.append(card);
    });
    renderOutcomes(stage, scene.workers.outcomes || []);
  }

  function renderQuiet(scene) {
    const office = el("office");
    const settled = scene.runState !== "working";
    office.classList.toggle("is-settled", settled);
    if (!settled) return;
    const latestCompleted = [...scene.events].reverse().find((event) => event.event_type === "session_completed");
    if (scene.runState === "paused") {
      el("quiet-kicker").textContent = "Company state · paused";
      el("quiet-title").textContent = "Stromation is paused";
      el("quiet-detail").textContent = latestCompleted
        ? `No workers are active. The last public session ended ${ago(latestCompleted.ts)}.`
        : "No workers are active. The public feed remains connected.";
    } else if (scene.runState === "offline" || scene.runState === "unknown") {
      el("quiet-kicker").textContent = "Public runtime state unavailable";
      el("quiet-title").textContent = "The theater cannot confirm current activity";
      el("quiet-detail").textContent = "Historical public events remain available below.";
    } else {
      el("quiet-kicker").textContent = app.mode === "replay" ? "Replay boundary" : "The office is quiet";
      el("quiet-title").textContent = app.mode === "replay" ? "This session is not active at this point" : "Stromation is between sessions";
      el("quiet-detail").textContent = latestCompleted
        ? `No workers are active. The last public session ended ${ago(latestCompleted.ts)}.`
        : "No workers are active. The theater will wake when the company does.";
    }
  }

  function renderStage(scene) {
    const state = app.publicState || {};
    el("office").dataset.solState = scene.solState;
    el("sol-name").textContent = state.ceo_name || "Sol";
    el("sol-state").textContent = SOL_LABELS[scene.solState] || "State unknown";
    el("sol-activity").textContent = scene.latest ? scene.latest.headline : "No current action has been published.";
    drawSprite(state.ceo_sprite);
    renderWorkers(scene);
    renderQuiet(scene);
    const workerPhrase = scene.workers.active.length === 1 ? "1 worker active" : `${scene.workers.active.length} workers active`;
    el("office-transcript").textContent = `${state.ceo_name || "Sol"}: ${SOL_LABELS[scene.solState] || "unknown"}. ${workerPhrase}. ${scene.latest ? `Latest event: ${scene.latest.headline}` : "No public events loaded."}`;
  }

  function renderHUD() {
    const state = app.publicState || {};
    setMetric("metric-budget", money(state.capital_usd));
    setMetric("metric-spend", money(state.spend_month_usd));
    setMetric("metric-revenue", money(state.revenue_total_usd));
    setMetric("metric-ventures", count(state.ventures_live));
    setMetric("metric-workers", count(state.workers_active));
    setMetric("metric-wake", known(state.next_wake_at) ? shortTime(state.next_wake_at) : "Unknown");
    el("hud-context").textContent = app.mode === "replay" ? "Current snapshot · not historical" : "Current public snapshot";
  }

  function renderFeed(events) {
    const feed = el("event-feed");
    feed.replaceChildren();
    const ordered = [...events].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, app.mode === "live" ? 140 : 500);
    if (!ordered.length) {
      const empty = node("li", "feed-empty");
      empty.append(node("strong", "", app.mode === "replay" ? "Replay is at its opening frame." : "No public events loaded."));
      empty.append(node("span", "", "Quiet is shown as quiet. Nothing is generated to fill the space."));
      feed.append(empty);
      return;
    }
    let previousDay = "";
    ordered.forEach((event) => {
      const day = dayLabel(event.ts);
      if (day !== previousDay) {
        feed.append(node("li", "event-day", day));
        previousDay = day;
      }
      const presentation = Core.presentationFor(event.event_type);
      const item = node("li", `event${presentation.major ? " is-major" : ""}${presentation.decision ? " is-decision" : ""}`);
      item.dataset.tone = presentation.tone;
      const time = node("time", "", shortTime(event.ts));
      time.dateTime = event.ts;
      item.append(time, node("span", "event-label", presentation.label));
      const copy = node("div", "event-copy");
      copy.append(node("strong", "", event.headline));
      if (event.summary) copy.append(node("p", "", event.summary));
      if (event.metric_label || event.metric_value) copy.append(node("p", "", [event.metric_label, event.metric_value].filter(Boolean).join(" · ")));
      if (event.link) {
        const link = node("a", "", "Open public artifact ↗");
        link.href = event.link;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        copy.append(link);
      }
      item.append(copy);
      feed.append(item);
    });
  }

  function renderConnection() {
    const bar = el("connection-bar");
    bar.className = "connection-bar";
    const status = app.realtimeStatus;
    const state = app.publicState || {};
    if (status === "connected") {
      const freshness = Core.stateFreshness(state, Date.now());
      bar.classList.add(freshness.stale ? "is-stale" : "is-live");
      el("connection-label").textContent = app.mode === "replay"
        ? "Replay"
        : freshness.stale ? "Connected · state stale" : "Live · connected";
      el("connection-detail").textContent = app.mode === "replay"
        ? "Realtime continues in the background."
        : freshness.stale ? "No recent runtime heartbeat. Showing the last confirmed state."
          : state.run_state === "paused" ? "Public feed connected · company paused." : "Receiving approved public events.";
    } else if (status === "reconnecting") {
      bar.classList.add("is-reconnecting");
      el("connection-label").textContent = "Reconnecting";
      el("connection-detail").textContent = "Showing the last confirmed public state.";
    } else if (status === "unavailable") {
      bar.classList.add("is-unavailable");
      el("connection-label").textContent = "Public feed unavailable";
      el("connection-detail").textContent = app.events.length ? "Historical events remain visible." : "No public data could be loaded.";
    } else {
      bar.classList.add("is-connecting");
      el("connection-label").textContent = "Connecting";
      el("connection-detail").textContent = "Opening the public feed…";
    }
    el("connection-time").textContent = app.fetchedAt ? `Last confirmed ${ago(app.fetchedAt)}` : "";
  }

  function renderClock(scene) {
    if (scene.sessionStart && scene.runState === "working") {
      el("session-clock").textContent = `Session · ${duration(Date.now() - Date.parse(scene.sessionStart))}`;
      return;
    }
    const lastComplete = [...scene.events].reverse().find((event) => event.event_type === "session_completed");
    el("session-clock").textContent = lastComplete ? `Last session · ${ago(lastComplete.ts)}` : "Session time unknown";
  }

  function render() {
    const scene = currentScene();
    el("objective-title").textContent = scene.objective;
    el("company-status").textContent = RUN_LABELS[scene.runState] || RUN_LABELS.unknown;
    el("current-action").textContent = scene.latest ? scene.latest.headline : "Waiting for the first public event.";
    el("mode-badge").textContent = app.mode === "replay" ? "Historical public session" : "Live company objective";
    el("stage-live-text").textContent = app.mode === "replay" ? "Historical scene" : "Public feed";
    renderClock(scene);
    renderStage(scene);
    renderProcess(scene.stage);
    renderHUD();
    renderFeed(scene.events);
    renderConnection();
  }

  function buildSessionOptions(preserveActiveReplay) {
    const select = el("session-select");
    const prior = app.selectedSession && app.selectedSession.id;
    app.sessions = Core.groupSessions(app.events);
    select.replaceChildren();
    if (!app.sessions.length) {
      const option = node("option", "", "No complete public sessions yet");
      option.value = "";
      select.append(option);
      select.disabled = true;
      app.selectedSession = null;
      updateEpisodeCard();
      return;
    }
    select.disabled = false;
    app.sessions.forEach((session) => {
      const option = node("option", "", `${longDate(session.startedAt)} · ${session.title}`);
      option.value = session.id;
      select.append(option);
    });
    app.selectedSession = app.sessions.find((session) => session.id === prior) || app.sessions[0];
    select.value = app.selectedSession.id;
    if (!(preserveActiveReplay && app.mode === "replay")) {
      app.replay.setEvents(app.selectedSession.events);
    }
    updateEpisodeCard();
    renderMajorJumps();
  }

  function updateEpisodeCard() {
    const session = app.selectedSession;
    el("episode-date").textContent = session ? longDate(session.startedAt) : "Unknown";
    el("episode-title").textContent = session ? session.title : "No session selected";
    el("episode-duration").textContent = session ? duration(session.durationMs) : "Unknown";
  }

  function renderMajorJumps() {
    const wrap = el("major-jumps");
    wrap.replaceChildren();
    const session = app.selectedSession;
    if (!session) return;
    session.majorIndexes.slice(0, 8).forEach((index) => {
      const event = session.events[index];
      const button = node("button", "", Core.presentationFor(event.event_type).label);
      button.type = "button";
      button.addEventListener("click", () => {
        switchMode("replay");
        app.replay.seek(index + 1);
      });
      wrap.append(button);
    });
  }

  function switchMode(mode) {
    app.mode = mode === "replay" ? "replay" : "live";
    const replay = app.mode === "replay";
    el("mode-live").classList.toggle("is-active", !replay);
    el("mode-live").setAttribute("aria-selected", String(!replay));
    el("mode-replay").classList.toggle("is-active", replay);
    el("mode-replay").setAttribute("aria-selected", String(replay));
    if (!replay) {
      app.replay.pause();
      app.replayEvents = [];
    }
    render();
  }

  function setupReplay() {
    app.replay = Core.createReplayController({
      events: [],
      onFrame(events, index, total) {
        app.replayEvents = events;
        el("replay-scrubber").max = String(total);
        el("replay-scrubber").value = String(index);
        el("replay-progress").textContent = `${index} / ${total}`;
        if (app.mode === "replay") render();
      },
      onState(snapshot) {
        el("replay-play").textContent = snapshot.playing ? "Pause" : "Play";
      }
    });
    el("mode-live").addEventListener("click", () => switchMode("live"));
    el("mode-replay").addEventListener("click", () => switchMode("replay"));
    el("session-select").addEventListener("change", (event) => {
      app.selectedSession = app.sessions.find((session) => session.id === event.target.value) || null;
      if (app.selectedSession) app.replay.setEvents(app.selectedSession.events);
      updateEpisodeCard();
      renderMajorJumps();
      switchMode("replay");
    });
    el("replay-play").addEventListener("click", () => {
      switchMode("replay");
      const state = app.replay.snapshot();
      if (state.index >= state.total && state.total) app.replay.restart();
      if (app.replay.snapshot().playing) app.replay.pause(); else app.replay.play();
    });
    el("replay-restart").addEventListener("click", () => { switchMode("replay"); app.replay.restart(); });
    el("replay-speed").addEventListener("change", (event) => app.replay.setSpeed(Number(event.target.value)));
    el("replay-scrubber").addEventListener("input", (event) => { switchMode("replay"); app.replay.seek(Number(event.target.value)); });
  }

  async function loadPublicData() {
    if (!window.supabase || !window.supabase.createClient) throw new Error("Supabase client unavailable");
    app.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    const [stateResult, eventResult] = await Promise.all([
      app.client.from(PUBLIC_TABLES[0]).select("*").limit(1),
      app.client.from(PUBLIC_TABLES[1]).select("*").order("ts", { ascending: false }).limit(MAX_HISTORY)
    ]);
    if (stateResult.error) throw stateResult.error;
    if (eventResult.error) throw eventResult.error;
    app.publicState = stateResult.data && stateResult.data[0] || null;
    app.events = Core.mergeEvents([], eventResult.data || []);
    app.fetchedAt = new Date().toISOString();
    buildSessionOptions();
    render();
  }

  function connectRealtime() {
    if (!app.client) return;
    app.channel = app.client.channel("stromation-live-theater")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: PUBLIC_TABLES[1] }, (payload) => {
        const before = app.events.length;
        app.events = Core.mergeEvents(app.events, [payload.new]);
        app.fetchedAt = new Date().toISOString();
        app.eventPulseId = app.events.length > before ? String(payload.new && payload.new.id) : app.eventPulseId;
        buildSessionOptions(true);
        if (app.mode === "live") render();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: PUBLIC_TABLES[0] }, (payload) => {
        app.publicState = payload.new || app.publicState;
        app.fetchedAt = new Date().toISOString();
        if (app.mode === "live") render(); else renderHUD();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") app.realtimeStatus = "connected";
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") app.realtimeStatus = "reconnecting";
        else if (status === "CLOSED") app.realtimeStatus = navigator.onLine ? "reconnecting" : "unavailable";
        renderConnection();
      });
  }

  async function reconnect() {
    if (!navigator.onLine) {
      app.realtimeStatus = "unavailable";
      renderConnection();
      return;
    }
    app.realtimeStatus = "reconnecting";
    renderConnection();
    try {
      if (app.channel && app.client) await app.client.removeChannel(app.channel);
      await loadPublicData();
      connectRealtime();
    } catch (_) {
      app.realtimeStatus = "unavailable";
      renderConnection();
    }
  }

  async function init() {
    setupReplay();
    renderProcess("orient");
    drawSprite(null);
    try {
      await loadPublicData();
      connectRealtime();
    } catch (error) {
      app.realtimeStatus = "unavailable";
      render();
      console.error("Stromation public feed unavailable:", error && error.message ? error.message : error);
    }
    window.addEventListener("offline", () => { app.realtimeStatus = "unavailable"; renderConnection(); });
    window.addEventListener("online", reconnect);
    app.timer = window.setInterval(() => {
      const scene = currentScene();
      renderClock(scene);
      renderWorkers(scene);
      renderConnection();
    }, 1000);
    window.__STROMATION_LIVE__ = Object.freeze({
      publicTables: PUBLIC_TABLES,
      get mode() { return app.mode; },
      get eventCount() { return app.events.length; },
      get connection() { return app.realtimeStatus; }
    });
  }

  init();
})();
