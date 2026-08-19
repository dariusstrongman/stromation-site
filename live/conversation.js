(function () {
  "use strict";

  const SUPABASE_URL = "https://oushyhkmekemygzxvabh.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91c2h5aGttZWtlbXlnenh2YWJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMTM0NDAsImV4cCI6MjEwMTY4OTQ0MH0.bvm3rJF6rY6_tL3Ra_AJgd0b3vkajt4J0Fs8MjhsvTg";
  const MAX_ROWS = 160;
  const VISIBLE_THREADS = 8;
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
    events: []
  };

  function clean(value, max) {
    if (value == null) return "";
    return String(value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max || 500);
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
      headline: clean(raw.headline, 300) || "Public event recorded.",
      summary: clean(raw.summary, 700) || null,
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
    return match ? { role: clean(match[1], 70), message: clean(match[2], 400) } : null;
  }

  function parseDelegated(headline) {
    const match = /^(.+?) on (.+?) was given work\.?$/i.exec(headline || "");
    return match ? { role: clean(match[1], 70), model: clean(match[2], 50) } : null;
  }

  function meaningful(event) {
    return clean(event.summary || event.headline, 700);
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
      eventCount: 0
    };
  }

  function addMessage(thread, speaker, role, message, ts, kind) {
    const text = clean(message, 700);
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
        active.eventCount += 1;
        addMessage(active, "Sol", active.role ? `To ${active.role}` : "Delegation", parsed ? parsed.message : meaningful(event), event.ts, "sol");
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
        active.eventCount += 1;
        active.endedAt = event.ts;
        return;
      }

      if (event.eventType === "worker_started" || event.eventType === "worker_working") {
        if (!active || active.status !== "In progress") {
          active = newThread(event, "delegation", "Worker task");
          threads.push(active);
        }
        active.eventCount += 1;
        active.endedAt = event.ts;
        return;
      }

      if (event.eventType === "worker_completed" || event.eventType === "worker_failed") {
        if (!active || active.status !== "In progress") {
          active = newThread(event, "delegation", "Worker return");
          threads.push(active);
        }
        active.eventCount += 1;
        active.endedAt = event.ts;
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
        council.eventCount += 1;
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
        council.eventCount += 1;
        council.endedAt = event.ts;
        addMessage(council, "Advisor", "Council response", meaningful(event), event.ts, "worker");
        return;
      }

      if (event.eventType === "council_concluded") {
        if (!council) {
          council = newThread(event, "council", "Council review");
          threads.push(council);
        }
        council.eventCount += 1;
        council.endedAt = event.ts;
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
    const item = node("li", "conversation-thread");
    item.dataset.kind = thread.type;

    const header = node("div", "conversation-card-head");
    const heading = node("div", "conversation-card-title");
    heading.append(node("strong", "", thread.title || "Work thread"));
    const detail = node("span", "", thread.model ? `via ${thread.model}` : thread.type === "council" ? "Independent review" : "Real delegation");
    heading.append(detail);

    const status = node("span", `conversation-status ${statusClass(thread.status)}`, thread.status);
    header.append(heading, status);

    const transcript = node("div", "conversation-transcript");
    thread.messages.forEach((message) => {
      const turn = node("div", `conversation-turn conversation-turn-${message.kind}`);
      const speaker = node("div", "conversation-speaker");
      speaker.append(node("strong", "", message.speaker), node("span", "", message.role));
      const copy = node("div", "conversation-copy");
      copy.append(node("p", "", message.text), node("time", "conversation-time", shortTime(message.ts)));
      turn.append(speaker, copy);
      transcript.append(turn);
    });

    const footer = node("div", "conversation-footer");
    footer.append(
      node("span", "conversation-proof", "Public event record"),
      node("span", "", `${thread.eventCount} event${thread.eventCount === 1 ? "" : "s"} · ${shortTime(thread.startedAt)}`)
    );

    item.append(header, transcript, footer);
    return item;
  }

  function render() {
    const shell = document.getElementById("delegation-conversations");
    if (!shell) return;
    shell.replaceChildren();

    const threads = buildThreads(state.events).slice(-VISIBLE_THREADS).reverse();

    if (!threads.length) {
      const empty = node("div", "conversation-empty");
      const wrap = node("div");
      wrap.append(
        node("strong", "", "No work conversations published yet."),
        node("span", "", "When Sol hands off real work, the meaningful exchange will appear here without the lifecycle noise.")
      );
      empty.append(wrap);
      shell.append(empty);
      return;
    }

    const list = node("ol", "conversation-list");
    threads.forEach((thread) => list.append(renderThread(thread)));
    shell.append(list);
  }

  async function load() {
    if (!window.supabase || !window.supabase.createClient) return;
    state.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const response = await state.client
      .from("public_events")
      .select("id,ts,event_type,headline,summary,actor")
      .order("ts", { ascending: false })
      .limit(MAX_ROWS);

    if (!response.error && Array.isArray(response.data)) {
      merge(response.data.reverse());
      render();
    }

    state.channel = state.client
      .channel("stromation-live-conversations")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "public_events" }, (payload) => {
        merge([payload.new]);
        render();
      })
      .subscribe();
  }

  function start() {
    render();
    load().catch(() => render());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
