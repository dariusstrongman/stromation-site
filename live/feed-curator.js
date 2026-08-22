(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StromationFeedCurator = api;
  if (root && root.document) api.boot(root.document, root);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FILTERS = Object.freeze(["all", "company", "workers", "sol", "review"]);
  const FILTER_LABELS = Object.freeze({
    all: "All",
    company: "Company",
    workers: "Workers",
    sol: "Sol",
    review: "Review"
  });
  const ROUTINE_SOL = new Set(["sol working", "sol thinking"]);
  const WORKER_LABELS = new Set([
    "handoff", "worker delegated", "worker started", "worker working",
    "worker returned", "worker stopped", "work conversation"
  ]);
  const REVIEW_LABELS = new Set([
    "quality review", "quality accepted", "quality rejected"
  ]);
  const state = { filter: "all", signature: null, observer: null, renderQueued: false };

  function clean(value, max) {
    if (value == null) return "";
    return String(value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max || 800);
  }

  function labelKey(value) {
    return clean(value, 80).toLowerCase();
  }

  function classifyLabel(label) {
    const key = labelKey(label);
    if (ROUTINE_SOL.has(key)) return "sol";
    if (REVIEW_LABELS.has(key) || /\b(review|gatekeeper)\b/.test(key)) return "review";
    if (WORKER_LABELS.has(key) || key.startsWith("worker ")) return "workers";
    if (key === "council exchange") return "company";
    return "company";
  }

  function isRoutineSol(label) {
    return ROUTINE_SOL.has(labelKey(label));
  }

  function filterAllows(filter, category) {
    const wanted = FILTERS.includes(filter) ? filter : "all";
    return wanted === "all" || wanted === category;
  }

  function groupRoutineSol(items) {
    const groups = [];
    let run = [];
    const flush = () => {
      if (run.length >= 2) groups.push(run);
      run = [];
    };
    (items || []).forEach((item) => {
      if (item && item.boundary) {
        flush();
        return;
      }
      if (item && isRoutineSol(item.label)) {
        run.push(item);
      } else {
        flush();
      }
    });
    flush();
    return groups;
  }

  function shortTime(value) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return "Time unknown";
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric", minute: "2-digit", second: "2-digit"
    }).format(parsed);
  }

  function spanLabel(items) {
    if (!items || items.length < 2) return "";
    const times = items.map((item) => Date.parse(item.ts)).filter(Number.isFinite);
    if (times.length < 2) return "";
    const seconds = Math.max(0, Math.round((Math.max(...times) - Math.min(...times)) / 1000));
    if (seconds < 60) return `${seconds}s span`;
    const minutes = Math.max(1, Math.round(seconds / 60));
    return `${minutes}m span`;
  }

  function eventMeta(row) {
    const time = row.querySelector(":scope > time");
    const label = row.querySelector(":scope > .event-label");
    const headline = row.querySelector(".event-copy > strong");
    const paragraphs = [...row.querySelectorAll(".event-copy > p")];
    return {
      row,
      ts: time && time.dateTime || "",
      label: clean(label && label.textContent, 80),
      headline: clean(headline && headline.textContent, 320),
      summary: clean(paragraphs[0] && paragraphs[0].textContent, 800) || null
    };
  }

  function resetGroups(feed) {
    feed.querySelectorAll(".event-sol-group").forEach((row) => row.remove());
    feed.querySelectorAll('li.event[data-sol-group-hidden="true"]').forEach((row) => {
      row.hidden = false;
      delete row.dataset.solGroupHidden;
    });
  }

  function ensureControls(doc) {
    let controls = doc.getElementById("feed-filters");
    if (!controls) {
      const feed = doc.getElementById("event-feed");
      if (!feed || !feed.parentNode) return null;
      controls = doc.createElement("div");
      controls.id = "feed-filters";
      controls.className = "feed-filters";
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", "Filter company feed");
      feed.parentNode.insertBefore(controls, feed);
    }
    if (!controls.children.length) {
      FILTERS.forEach((filter) => {
        const button = doc.createElement("button");
        button.type = "button";
        button.dataset.feedFilter = filter;
        button.textContent = FILTER_LABELS[filter];
        button.setAttribute("aria-pressed", String(filter === state.filter));
        button.addEventListener("click", () => {
          state.filter = filter;
          applyFilter(doc);
        });
        controls.appendChild(button);
      });
    }
    return controls;
  }

  function sourceStep(doc, item) {
    const li = doc.createElement("li");
    const top = doc.createElement("div");
    top.className = "sol-step-head";
    const time = doc.createElement("time");
    time.dateTime = item.ts || "";
    time.textContent = shortTime(item.ts);
    const label = doc.createElement("span");
    label.textContent = item.label || "Sol activity";
    top.append(time, label);
    const headline = doc.createElement("strong");
    headline.textContent = item.headline || "Recorded public action.";
    li.append(top, headline);
    if (item.summary && item.summary !== item.headline) {
      const summary = doc.createElement("p");
      summary.textContent = item.summary;
      li.append(summary);
    }
    return li;
  }

  function createSolGroup(doc, items) {
    const newest = items[0];
    const row = doc.createElement("li");
    row.className = "event event-sol-group";
    row.dataset.feedCategory = "sol";
    row.dataset.tone = "plain";

    const time = doc.createElement("time");
    time.dateTime = newest.ts || "";
    time.textContent = shortTime(newest.ts);
    const label = doc.createElement("span");
    label.className = "event-label";
    label.textContent = "Sol activity";

    const copy = doc.createElement("div");
    copy.className = "event-copy sol-group-copy";
    const heading = doc.createElement("strong");
    heading.textContent = `Sol worked through ${items.length} recorded actions`;
    const meta = doc.createElement("p");
    const span = spanLabel(items);
    meta.textContent = ["Routine public steps collapsed", span].filter(Boolean).join(" · ");

    const details = doc.createElement("details");
    details.className = "sol-group-details";
    const summary = doc.createElement("summary");
    summary.textContent = `Show ${items.length} recorded steps`;
    const list = doc.createElement("ol");
    list.className = "sol-step-list";
    items.forEach((item) => list.appendChild(sourceStep(doc, item)));
    details.append(summary, list);
    copy.append(heading, meta, details);
    row.append(time, label, copy);
    return row;
  }

  function applyFilter(doc) {
    const feed = doc.getElementById("event-feed");
    if (!feed) return;
    const controls = doc.getElementById("feed-filters");
    if (controls) {
      [...controls.querySelectorAll("button[data-feed-filter]")].forEach((button) => {
        const active = button.dataset.feedFilter === state.filter;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }
    [...feed.children].forEach((row) => {
      if (!row.classList || !row.classList.contains("event")) return;
      if (row.dataset.conversationHidden === "true" || row.dataset.solGroupHidden === "true") {
        row.hidden = true;
        return;
      }
      const category = row.dataset.feedCategory || "company";
      row.hidden = !filterAllows(state.filter, category);
    });
  }

  function curate(doc) {
    const feed = doc.getElementById("event-feed");
    if (!feed) return;
    ensureControls(doc);
    resetGroups(feed);

    const direct = [...feed.children];
    direct.forEach((row) => {
      if (!row.classList || !row.classList.contains("event")) return;
      const label = row.querySelector(":scope > .event-label");
      const category = row.classList.contains("event-conversation")
        ? (labelKey(label && label.textContent) === "council exchange" ? "company" : "workers")
        : classifyLabel(label && label.textContent);
      row.dataset.feedCategory = category;
      if (row.classList.contains("is-major") || row.classList.contains("event-conversation") || category === "review") {
        row.classList.add("is-feed-major");
      } else {
        row.classList.remove("is-feed-major");
      }
    });

    let run = [];
    const flush = () => {
      if (run.length >= 2) {
        const items = run.map(eventMeta);
        const group = createSolGroup(doc, items);
        run[0].parentNode.insertBefore(group, run[0]);
        run.forEach((row) => {
          row.hidden = true;
          row.dataset.solGroupHidden = "true";
        });
      }
      run = [];
    };

    [...feed.children].forEach((row) => {
      if (!row.classList || !row.classList.contains("event")) {
        flush();
        return;
      }
      if (row.classList.contains("event-conversation") || row.dataset.conversationHidden === "true") {
        flush();
        return;
      }
      const label = row.querySelector(":scope > .event-label");
      if (isRoutineSol(label && label.textContent)) run.push(row);
      else flush();
    });
    flush();
    applyFilter(doc);
  }

  function feedSignature(feed) {
    return [...feed.children]
      .filter((row) => row.classList && row.classList.contains("event")
        && !row.classList.contains("event-sol-group"))
      .map((row) => {
        const time = row.querySelector(":scope > time");
        const label = row.querySelector(":scope > .event-label");
        const headline = row.querySelector(".event-copy > strong");
        return [
          row.classList.contains("event-conversation") ? "conversation" : "event",
          time && time.dateTime || "",
          clean(label && label.textContent, 80),
          clean(headline && headline.textContent, 320)
        ].join("|");
      }).join("\n");
  }

  function refresh(doc) {
    const feed = doc.getElementById("event-feed");
    if (!feed) return;
    const signature = feedSignature(feed);
    if (signature === state.signature) {
      ensureControls(doc);
      applyFilter(doc);
      return;
    }
    state.signature = signature;
    curate(doc);
  }

  function boot(doc, root) {
    const start = () => {
      const feed = doc.getElementById("event-feed");
      if (!feed) return;
      const MutationObserverImpl = root && root.MutationObserver;
      if (MutationObserverImpl) {
        state.observer = new MutationObserverImpl(() => {
          if (state.renderQueued) return;
          state.renderQueued = true;
          const run = root.requestAnimationFrame || ((fn) => root.setTimeout(fn, 0));
          run(() => {
            state.renderQueued = false;
            refresh(doc);
          });
        });
        state.observer.observe(feed, { childList: true, subtree: false });
      }
      refresh(doc);
    };
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }

  function setFilter(filter, doc) {
    state.filter = FILTERS.includes(filter) ? filter : "all";
    if (doc) applyFilter(doc);
    return state.filter;
  }

  return {
    FILTERS,
    classifyLabel,
    isRoutineSol,
    filterAllows,
    groupRoutineSol,
    spanLabel,
    feedSignature,
    refresh,
    boot,
    curate,
    applyFilter,
    setFilter
  };
});
