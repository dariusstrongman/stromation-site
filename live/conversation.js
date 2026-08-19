(function () {
  "use strict";

  const SUPABASE_URL = "https://oushyhkmekemygzxvabh.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91c2h5aGttZWtlbXlnenh2YWJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMTM0NDAsImV4cCI6MjEwMTY4OTQ0MH0.bvm3rJF6rY6_tL3Ra_AJgd0b3vkajt4J0Fs8MjhsvTg";
  const MAX_ROWS = 180;
  const MAX_THREADS = 10;
  const RELEVANT_TYPES = new Set([
    "handoff_started",
    "worker_delegated",
    "worker_started",
    "worker_working",
    "worker_completed",
    "worker_failed",
    "council_convened",
    "council_spoke",
    "council_concluded"
  ]);

  const state = {
    client: null,
    channel: null,
    observer: null,
    events: [],
    renderQueued: false
  };

  function clean(value, max) {
    if (value == null) return "";
    return String(value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max || 700);
  }

  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function eventKey(event) {
    return String(event.id || `${event.ts}|${event.event_type}|${event.headline}`);
  }

  function normalize(raw) {
    if (!raw || typeof raw !== "object") return null;
    const eventType = clean(raw.event_type, 64);
    if (!RELEVANT_TYPES.has(eventType)) return null;
    const parsed = Date.parse(raw.ts);
    if (!Number.isFinite(parsed)) return null;
    return {
      id: eventKey(raw),
      ts: new Date(parsed).toISOString(),
      eventType,
      headline: clean(raw.headline, 320) || "Public event recorded.",
      summary: clean(raw.summary, 800) || null,
      actor: ["sol", "worker", "system", "owner"].includes(raw.actor) ? raw.actor : "system"
    };
  }

  function merge(incoming) {
    const map = new Map(state.events.map((event) => [event.id, event]));
    (incoming || []).forEach((raw) => {
      const event = normalize(raw);
      if (event) map.set(event.id, event);
    });
    state.events = [...map.values()]
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
      .slice(-MAX_ROWS);
  }

  function shortTime(value) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return "Time unknown";
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit"
    }).format(parsed);
  }

  function parseHandoff(headline) {
    const match = /^Sol handed this to (.+?):\s*(.+)$/i.exec(headline || "");
    return match ? { role: clean(match[1], 70), message: clean(match[2], 500) } : null;
  }

  function parseDelegated(headline) {
    const match = /^(.+?) on (.+?) was given work\.?$/i.exec(headline || "");
    return match ? { role: clean(match[1], 70), model: clean(match[2], 60) } : null;
  }

  function meaningful(event) {
    return clean(event.summary || event.headline, 800);
  }

  function newThread(event, type, title) {
    return {
      id: event.id,
      type,
      title,
      role: null,
      model: null,
      startedAt: event.ts,
      endedAt: event.ts,
      status: "In progress",
      messages: [],
      sourceEvents: []
    };
  }

  function addSource(thread, event) {
    thread.sourceEvents.push({ ts: event.ts, headline: event.headline });
    thread.endedAt = event.ts;
  }

  function addMessage(thread, speaker, role, message, ts, kind) {
    const text = clean(message, 800);
    if (!text) return;
    const previous = thread.messages[thread.messages.length - 1];
    if (previous && previous.speaker === speaker && previous.text === text) return;
    thread.messages.push({ speaker, role, text, ts, kind });
  }

  function buildThreads(events) {
    const threads = [];
    let active = null;
    let council = null;

    events.forEach((event) => {
      if (event.eventType === "handoff_started") {
        const parsed = parseHandoff(event.headline);
        active = newThread(event, "delegation", parsed ? parsed.role : "Delegated work");
        active.role = parsed ? parsed.role : null;
        addSource(active, event);
        addMessage(
          active,
          "Sol",
          active.role ? `To ${active.role}` : "Delegation",
          parsed ? parsed.message : meaningful(event),
          event.ts,
          "sol"
        );
        threads.push(active);
        return;
      }

      if (event.eventType === "worker_delegated") {
        const parsed = parseDelegated(event.headline);
        if (!active || active.status !== "In progress") {
          active = newThread(event, "delegation", parsed ? parsed.role : "Worker task");
          threads.push(active);
        }
        active.role = active.role || (parsed && parsed.role) || "Worker";
        active.title = active.role || active.title;
        active.model = (parsed && parsed.model) || active.model;
        addSource(active, event);
        return;
      }

      if (event.eventType === "worker_started" || event.eventType === "worker_working") {
        if (!active || active.status !== "In progress") {
          active = newThread(event, "delegation", "Worker task");
          threads.push(active);
        }
        addSource(active, event);
        return;
      }

      if (event.eventType === "worker_completed" || event.eventType === "worker_failed") {
        if (!active || active.status !== "In progress") {
          active = newThread(event, "delegation", "Worker return");
          threads.push(active);
        }
        addSource(active, event);
        active.status = event.eventType === "worker_completed" ? "Completed" : "Stopped";
        addMessage(
          active,
          active.role || "Worker",
          event.eventType === "worker_completed" ? "Return to Sol" : "Stopped",
          meaningful(event),
          event.ts,
          event.eventType === "worker_completed" ? "worker" : "failure"
        );
        active = null;
        return;
      }

      if (event.eventType === "council_convened") {
        council = newThread(event, "council", "Council review");
        council.status = "In review";
        addSource(council, event);
        addMessage(council, "Sol", "To council", meaningful(event), event.ts, "sol");
        threads.push(council);
        return;
      }

      if (event.eventType === "council_spoke") {
        if (!council) {
          council = newThread(event, "council", "Council review");
          council.status = "In review";
          threads.push(council);
        }
        addSource(council, event);
        addMessage(council, "Advisor", "Council response", meaningful(event), event.ts, "worker");
        return;
      }

      if (event.eventType === "council_concluded") {
        if (!council) {
          council = newThread(event, "council", "Council review");
          threads.push(council);
        }
        addSource(council, event);
        council.status = "Concluded";
        addMessage(council, "Sol", "Conclusion", meaningful(event), event.ts, "sol");
        council = null;
      }
    });

    return threads.filter((thread) => thread.messages.length > 0);
  }

  function statusClass(status) {
    if (status === "Completed" || status === "Concluded") return "is-complete";
    if (status === "Stopped") return "is-failed";
    return "is-active";
  }

  function renderThread(thread) {
    const item = node("li", "event event-conversation");
    item.dataset.tone = thread.status === "Stopped" ? "bad" : thread.status === "Completed" || thread.status === "Concluded" ? "good" : "cyan";
    item.dataset.threadId = thread.id;

    const time = node("time", "", shortTime(thread.endedAt || thread.startedAt));
    time.dateTime = thread.endedAt || thread.startedAt;
    const label = node("span", "event-label", thread.type === "council" ? "Council conversation" : "Work conversation");

    const copy = node("div", "event-copy conversation-feed-copy");
    const header = node("div", "conversation-card-head");
    const heading = node("div", "conversation-card-title");
    heading.append(node("strong", "", thread.title || "Work thread"));
    heading.append(node("span", "", thread.model ? `via ${thread.model}` : thread.type === "council" ? "Independent review" : "Real delegation"));
    header.append(heading, node("span", `conversation-status ${statusClass(thread.status)}`, thread.status));
    copy.append(header);

    const transcript = node("div", "conversation-transcript");
    thread.messages.forEach((message) => {
      const turn = node("div", `conversation-turn conversation-turn-${message.kind}`);
      const speaker = node("div", "conversation-speaker");
      speaker.append(node("strong", "", message.speaker), node("span", "", message.role));
      const messageCopy = node("div", "conversation-copy");
      messageCopy.append(node("p", "", message.text), node("time", "conversation-time", shortTime(message.ts)));
      turn.append(speaker, messageCopy);
      transcript.append(turn);
    });
    copy.append(transcript);

    const footer = node("div", "conversation-footer");
    footer.append(
      node("span", "conversation-proof", "Public event record"),
      node("span", "", `${thread.sourceEvents.length} source event${thread.sourceEvents.length === 1 ? "" : "s"}`)
    );
    copy.append(footer);

    item.append(time, label, copy);
    return item;
  }

  function findRawEvent(feed, source) {
    const rows = [...feed.querySelectorAll("li.event:not(.event-conversation)")];
    return rows.find((row) => {
      const time = row.querySelector(":scope > time");
      const headline = row.querySelector(".event-copy > strong");
      return time && headline && time.dateTime === source.ts && clean(headline.textContent, 320) === source.headline;
    }) || null;
  }

  function insertChronologically(feed, card, timestamp) {
    const when = Date.parse(timestamp);
    const rows = [...feed.children];
    const anchor = rows.find((row) => {
      if (!(row instanceof HTMLElement) || !row.classList.contains("event")) return false;
      const time = row.querySelector(":scope > time");
      if (!time || !time.dateTime) return false;
      return Date.parse(time.dateTime) <= when;
    });
    if (anchor) feed.insertBefore(card, anchor);
    else feed.append(card);
  }

  function renderIntoFeed() {
    const feed = document.getElementById("event-feed");
    if (!feed) return;

    if (state.observer) state.observer.disconnect();
    feed.querySelectorAll(".event-conversation").forEach((row) => row.remove());
    feed.querySelectorAll("li.event[data-conversation-hidden=\"true\"]").forEach((row) => {
      row.hidden = false;
      delete row.dataset.conversationHidden;
    });

    const threads = buildThreads(state.events).slice(-MAX_THREADS).reverse();
    threads.forEach((thread) => {
      thread.sourceEvents.forEach((source) => {
        const raw = findRawEvent(feed, source);
        if (raw) {
          raw.hidden = true;
          raw.dataset.conversationHidden = "true";
        }
      });
      insertChronologically(feed, renderThread(thread), thread.endedAt || thread.startedAt);
    });

    if (state.observer) {
      state.observer.observe(feed, { childList: true, subtree: false });
    }
  }

  function queueRender() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(() => {
      state.renderQueued = false;
      renderIntoFeed();
    });
  }

  function watchFeed() {
    const feed = document.getElementById("event-feed");
    if (!feed || !window.MutationObserver) return;
    state.observer = new MutationObserver(() => queueRender());
    state.observer.observe(feed, { childList: true, subtree: false });
  }

  async function load() {
    if (!window.supabase || !window.supabase.createClient) return;
    state.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const response = await state.client
      .from("public_events")
      .select("id,ts,event_type,headline,summary,actor")
      .in("event_type", [...RELEVANT_TYPES])
      .order("ts", { ascending: false })
      .limit(MAX_ROWS);

    if (!response.error && Array.isArray(response.data)) {
      merge(response.data.reverse());
      queueRender();
    }

    state.channel = state.client
      .channel("stromation-live-conversation-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "public_events" }, (payload) => {
        if (!payload.new || !RELEVANT_TYPES.has(payload.new.event_type)) return;
        merge([payload.new]);
        queueRender();
      })
      .subscribe();
  }

  function start() {
    watchFeed();
    load().catch(() => queueRender());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
