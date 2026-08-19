(function () {
  "use strict";

  const MAX_THREADS = 10;
  const state = {
    observer: null,
    renderQueued: false
  };

  function clean(value, max) {
    if (value == null) return "";
    return String(value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max || 800);
  }

  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
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

  function eventKind(label) {
    const value = clean(label, 80).toLowerCase();
    if (value === "handoff") return "handoff";
    if (value === "worker delegated") return "delegated";
    if (value === "worker started") return "started";
    if (value === "worker working") return "working";
    if (value === "worker returned") return "completed";
    if (value === "worker stopped") return "failed";
    if (value === "council convened") return "council_convened";
    if (value === "council response") return "council_spoke";
    if (value === "council concluded") return "council_concluded";
    return null;
  }

  function readEvents(feed) {
    const rows = [...feed.querySelectorAll("li.event:not(.event-conversation)")];
    return rows.map((row, index) => {
      const time = row.querySelector(":scope > time");
      const label = row.querySelector(":scope > .event-label");
      const headline = row.querySelector(".event-copy > strong");
      const summary = row.querySelector(".event-copy > p");
      const ts = time && time.dateTime;
      const kind = eventKind(label && label.textContent);
      if (!ts || !kind || !headline) return null;
      return {
        id: `${ts}|${kind}|${index}`,
        row,
        ts,
        kind,
        headline: clean(headline.textContent, 320),
        summary: clean(summary && summary.textContent, 800) || null
      };
    }).filter(Boolean).reverse();
  }

  function meaningful(event) {
    return event.summary || event.headline;
  }

  function newThread(event, type, title) {
    return {
      id: event.id,
      type,
      title,
      role: null,
      model: null,
      status: "Active",
      messages: [],
      sources: [],
      hasHandoff: false
    };
  }

  function addSource(thread, event) {
    if (thread.sources.some((source) => source.id === event.id)) return;
    thread.sources.push(event);
  }

  function addMessage(thread, speaker, role, message, event, kind) {
    const text = clean(message, 800);
    if (!text) return;
    const previous = thread.messages[thread.messages.length - 1];
    if (previous && previous.speaker === speaker && previous.text === text) return;
    thread.messages.push({ speaker, role, text, ts: event.ts, kind });
  }

  function openDelegations(threads) {
    return threads.filter((thread) => thread.type === "delegation" && thread.status === "Active");
  }

  function newestMatchingRole(threads, role) {
    const wanted = clean(role, 70).toLowerCase();
    if (!wanted) return null;
    return [...openDelegations(threads)].reverse().find((thread) =>
      clean(thread.role, 70).toLowerCase() === wanted
    ) || null;
  }

  function buildThreads(events) {
    const threads = [];
    let council = null;

    events.forEach((event) => {
      if (event.kind === "handoff") {
        const parsed = parseHandoff(event.headline);
        let thread = parsed ? newestMatchingRole(threads, parsed.role) : null;
        if (!thread || thread.hasHandoff) {
          thread = newThread(event, "delegation", parsed ? parsed.role : "Delegated work");
          threads.push(thread);
        }
        thread.role = thread.role || (parsed && parsed.role) || null;
        thread.title = thread.role || thread.title;
        thread.hasHandoff = true;
        addSource(thread, event);
        addMessage(
          thread,
          "Sol",
          thread.role ? `To ${thread.role}` : "Handoff",
          parsed ? parsed.message : meaningful(event),
          event,
          "sol"
        );
        return;
      }

      if (event.kind === "delegated") {
        const parsed = parseDelegated(event.headline);
        let thread = parsed ? newestMatchingRole(threads, parsed.role) : null;
        if (!thread) {
          thread = newThread(event, "delegation", parsed ? parsed.role : "Worker task");
          threads.push(thread);
        }
        thread.role = thread.role || (parsed && parsed.role) || "Worker";
        thread.title = thread.role || thread.title;
        thread.model = (parsed && parsed.model) || thread.model;
        addSource(thread, event);
        return;
      }

      if (event.kind === "started" || event.kind === "working") {
        const open = openDelegations(threads);
        if (open.length === 1) addSource(open[0], event);
        return;
      }

      if (event.kind === "completed" || event.kind === "failed") {
        const open = openDelegations(threads);
        let thread;
        if (open.length === 1) {
          thread = open[0];
        } else {
          thread = newThread(event, "delegation", "Worker outcome");
          thread.role = "Worker";
          threads.push(thread);
        }
        addSource(thread, event);
        thread.status = event.kind === "completed" ? "Completed" : "Stopped";
        addMessage(
          thread,
          thread.role || "Worker",
          event.kind === "completed" ? "Returned" : "Stopped",
          meaningful(event),
          event,
          event.kind === "completed" ? "worker" : "failure"
        );
        return;
      }

      if (event.kind === "council_convened") {
        council = newThread(event, "council", "Council activity");
        addSource(council, event);
        addMessage(council, "Sol", "To council", meaningful(event), event, "sol");
        threads.push(council);
        return;
      }

      if (event.kind === "council_spoke") {
        if (!council || council.status !== "Active") {
          council = newThread(event, "council", "Council activity");
          threads.push(council);
        }
        addSource(council, event);
        addMessage(council, "Advisor", "Council response", meaningful(event), event, "worker");
        return;
      }

      if (event.kind === "council_concluded") {
        if (!council || council.status !== "Active") {
          council = newThread(event, "council", "Council activity");
          threads.push(council);
        }
        addSource(council, event);
        council.status = "Concluded";
        addMessage(council, "Sol", "Conclusion", meaningful(event), event, "sol");
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
    const lastSource = thread.sources[thread.sources.length - 1];
    const item = node("li", "event event-conversation");
    item.dataset.tone = thread.status === "Stopped" ? "bad" : thread.status === "Completed" || thread.status === "Concluded" ? "good" : "cyan";
    item.dataset.threadId = thread.id;

    const time = node("time", "", shortTime(lastSource.ts));
    time.dateTime = lastSource.ts;
    const label = node("span", "event-label", thread.type === "council" ? "Council exchange" : "Work conversation");

    const copy = node("div", "event-copy conversation-feed-copy");
    const header = node("div", "conversation-card-head");
    const heading = node("div", "conversation-card-title");
    heading.append(node("strong", "", thread.title || "Work thread"));
    heading.append(node("span", "", thread.model ? `via ${thread.model}` : thread.type === "council" ? "Recorded council events" : "Recorded handoff"));
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
      node("span", "", `${thread.sources.length} source event${thread.sources.length === 1 ? "" : "s"}`)
    );
    copy.append(footer);

    item.append(time, label, copy);
    return item;
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

    const events = readEvents(feed);
    const threads = buildThreads(events).slice(-MAX_THREADS).reverse();
    threads.forEach((thread) => {
      thread.sources.forEach((source) => {
        source.row.hidden = true;
        source.row.dataset.conversationHidden = "true";
      });
      const card = renderThread(thread);
      const lastSource = thread.sources[thread.sources.length - 1];
      insertChronologically(feed, card, lastSource.ts);
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
    queueRender();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchFeed, { once: true });
  } else {
    watchFeed();
  }
})();
