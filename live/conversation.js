(function () {
  "use strict";

  const SUPABASE_URL = "https://oushyhkmekemygzxvabh.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91c2h5aGttZWtlbXlnenh2YWJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMTM0NDAsImV4cCI6MjEwMTY4OTQ0MH0.bvm3rJF6rY6_tL3Ra_AJgd0b3vkajt4J0Fs8MjhsvTg";
  const MAX_ROWS = 120;
  const VISIBLE_ROWS = 18;
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
      headline: clean(raw.headline, 240) || "Public event recorded.",
      summary: clean(raw.summary, 500) || null,
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
      minute: "2-digit",
      second: "2-digit"
    }).format(parsed);
  }

  function parseHandoff(headline) {
    const match = /^Sol handed this to (.+?):\s*(.+)$/i.exec(headline || "");
    return match ? { role: clean(match[1], 60), message: clean(match[2], 240) } : null;
  }

  function parseDelegated(headline) {
    const match = /^(.+?) on (.+?) was given work\.?$/i.exec(headline || "");
    return match ? { role: clean(match[1], 60), model: clean(match[2], 40) } : null;
  }

  function presentation(event) {
    const handoff = event.eventType === "handoff_started" ? parseHandoff(event.headline) : null;
    const delegated = event.eventType === "worker_delegated" ? parseDelegated(event.headline) : null;

    if (handoff) {
      return {
        speaker: "Sol",
        role: `To ${handoff.role}`,
        message: handoff.message,
        kind: "handoff",
        proof: "Recorded delegation handoff"
      };
    }

    if (delegated) {
      return {
        speaker: delegated.role || "Worker",
        role: "Delegation accepted",
        message: `Assigned on ${delegated.model || "an approved model"}.`,
        kind: "worker",
        proof: "Worker delegation recorded"
      };
    }

    if (event.eventType === "worker_started" || event.eventType === "worker_working") {
      return {
        speaker: "Worker",
        role: event.eventType === "worker_started" ? "Started" : "Working",
        message: event.summary || event.headline,
        kind: "worker",
        proof: "Worker activity recorded"
      };
    }

    if (event.eventType === "worker_completed") {
      return {
        speaker: "Worker",
        role: "Returned to Sol",
        message: event.summary || event.headline,
        kind: "worker",
        proof: "Worker completion recorded"
      };
    }

    if (event.eventType === "worker_failed") {
      return {
        speaker: "Worker",
        role: "Stopped",
        message: event.summary || event.headline,
        kind: "failure",
        proof: "Worker failure recorded"
      };
    }

    if (event.eventType === "council_convened") {
      return {
        speaker: "Sol",
        role: "To council",
        message: event.summary || event.headline,
        kind: "sol",
        proof: "Council request recorded"
      };
    }

    if (event.eventType === "council_spoke") {
      return {
        speaker: "Advisor",
        role: "Council response",
        message: event.summary || event.headline,
        kind: "worker",
        proof: "Council response recorded"
      };
    }

    if (event.eventType === "council_concluded") {
      return {
        speaker: "Sol",
        role: "Council conclusion",
        message: event.summary || event.headline,
        kind: "sol",
        proof: "Council conclusion recorded"
      };
    }

    return null;
  }

  function render() {
    const shell = document.getElementById("delegation-conversations");
    if (!shell) return;
    shell.replaceChildren();

    const rows = state.events
      .map((event) => ({ event, view: presentation(event) }))
      .filter((item) => item.view)
      .slice(-VISIBLE_ROWS);

    if (!rows.length) {
      const empty = node("div", "conversation-empty");
      const wrap = node("div");
      wrap.append(
        node("strong", "", "No delegation conversation published yet."),
        node("span", "", "When Sol hands work to a colleague, public-safe proof will appear here from real events.")
      );
      empty.append(wrap);
      shell.append(empty);
      return;
    }

    const list = node("ol", "conversation-list");
    rows.forEach(({ event, view }) => {
      const item = node("li", "conversation-thread");
      item.dataset.kind = view.kind;

      const speaker = node("div", "conversation-speaker");
      speaker.append(node("strong", "", view.speaker), node("span", "", view.role));

      const copy = node("div", "conversation-copy");
      copy.append(node("p", "", view.message));
      const meta = node("div", "conversation-meta");
      meta.append(node("span", "", shortTime(event.ts)), node("span", "", event.eventType.replaceAll("_", " ")));
      copy.append(meta, node("span", "conversation-proof", view.proof));

      item.append(speaker, copy);
      list.append(item);
    });

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
