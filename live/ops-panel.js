/* Stromation Live — the operations panel.
 *
 * Answers, from real published state only: what is the company doing
 * right now, which department owns it, which seat/engine is executing,
 * what authority they were granted, what stage the work is in, what
 * the Gatekeeper ruled, and what ultimately happened.
 *
 * Every field here comes from public_state.observer — the same
 * curated, fail-closed block the external observer endpoint serves.
 * Nothing is inferred: a missing field renders as absent or unknown,
 * never invented. Private work renders as exactly "private work".
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StromationOps = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERDICT = Object.freeze({
    PASS:   { label: "Gatekeeper: PASS",   tone: "good" },
    REVISE: { label: "Gatekeeper: REVISE", tone: "warn" },
    BLOCK:  { label: "Gatekeeper: BLOCK",  tone: "bad" }
  });

  const DELEGATION_STATUS = Object.freeze({
    running: { label: "working now", tone: "cyan" },
    pending: { label: "queued",      tone: "plain" },
    done:    { label: "done",        tone: "good" },
    failed:  { label: "failed",      tone: "bad" }
  });

  const FAILURE_WORDS = Object.freeze({
    not_completion_capable: "refused before any spend",
    routing_refused: "routing refused it",
    missing_deliverable: "deliverable not proven",
    similarity: "too similar to existing work",
    provenance: "claims lacked provenance",
    other: "failed"
  });

  function has(value) {
    return value !== null && value !== undefined && value !== "";
  }

  function clock(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    return new Intl.DateTimeFormat(undefined,
      { hour: "numeric", minute: "2-digit" }).format(t);
  }

  function seconds(fromIso, toIso) {
    const a = Date.parse(fromIso), b = Date.parse(toIso);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
    return Math.round((b - a) / 1000);
  }

  /* The stage the CURRENT work item is provably in, from the newest
   * delegation + grant + verdict. Truth order: a running delegation is
   * "executing"; a live grant with no running delegation still means
   * the credential is out; a verdict tells review state; merged is
   * terminal. Absent everything: no active work item. */
  function deriveStage(vm) {
    if (vm.workItem && vm.workItem.merged === true) return "shipped";
    if (vm.delegations.some((d) => d.status === "running")) return "executing";
    if (vm.grants.some((g) => g.active)) return "credential out";
    if (vm.workItem && vm.workItem.verdict === "PASS") return "awaiting merge";
    if (vm.workItem && (vm.workItem.verdict === "REVISE" ||
                        vm.workItem.verdict === "BLOCK")) return "in review";
    if (vm.delegations.length) return "handed off";
    return null;
  }

  /* observer jsonb -> a display-ready view model. Pure. */
  function buildViewModel(observer) {
    const obs = (observer && typeof observer === "object") ? observer : {};
    const vm = { session: null, delegations: [], grants: [],
                 workItem: null, stage: null, empty: true };

    const s = obs.session;
    if (s && typeof s === "object" && has(s.id)) {
      vm.session = {
        id: String(s.id),
        active: s.phase === "active",
        turns: Number.isFinite(s.turns) ? s.turns : null,
        costUsd: Number.isFinite(s.cost_usd) ? s.cost_usd : null,
        startedAt: has(s.started_at) ? s.started_at : null,
        endedAt: has(s.ended_at) ? s.ended_at : null
      };
    }

    for (const d of Array.isArray(obs.delegations) ? obs.delegations : []) {
      if (!d || !has(d.id) || !DELEGATION_STATUS[d.status]) continue;
      vm.delegations.push({
        id: String(d.id),
        department: has(d.department) ? String(d.department) : null,
        seat: has(d.seat) ? String(d.seat) : null,
        engine: has(d.model_family) ? String(d.model_family) : null,
        status: d.status,
        statusLabel: DELEGATION_STATUS[d.status].label,
        tone: DELEGATION_STATUS[d.status].tone,
        failure: d.status === "failed"
          ? (FAILURE_WORDS[d.failure_category] || FAILURE_WORDS.other)
          : null,
        createdAt: has(d.created_at) ? d.created_at : null,
        completedAt: has(d.completed_at) ? d.completed_at : null
      });
    }

    for (const g of Array.isArray(obs.grants) ? obs.grants : []) {
      if (!g || !has(g.capability)) continue;
      const heldS = (has(g.issued_at) && has(g.revoked_at))
        ? seconds(g.issued_at, g.revoked_at) : null;
      vm.grants.push({
        capability: String(g.capability),
        scope: g.repo === "private" ? "private work"
          : (has(g.repo)
              ? String(g.repo) + (has(g.branch) ? " @ " + g.branch : "")
              : null),
        active: g.active === true,
        delegationId: has(g.delegation_id) ? String(g.delegation_id) : null,
        issuedAt: has(g.issued_at) ? g.issued_at : null,
        heldSeconds: heldS
      });
    }

    const w = obs.work_item;
    if (w && typeof w === "object" && has(w.gatekeeper_verdict) &&
        VERDICT[w.gatekeeper_verdict]) {
      vm.workItem = {
        repo: w.repo === "private" ? null : (has(w.repo) ? String(w.repo) : null),
        isPrivate: w.repo === "private",
        pr: Number.isFinite(w.pr) ? w.pr : null,
        verdict: w.gatekeeper_verdict,
        verdictLabel: VERDICT[w.gatekeeper_verdict].label,
        verdictTone: VERDICT[w.gatekeeper_verdict].tone,
        reviewedSha: has(w.verdict_head_sha) ? String(w.verdict_head_sha) : null,
        round: Number.isFinite(w.deliberation_round)
          ? w.deliberation_round : null,
        merged: w.merged === true ? true : (w.merged === false ? false : null)
      };
    }

    vm.empty = !vm.session && !vm.delegations.length && !vm.grants.length
      && !vm.workItem;
    vm.stage = deriveStage(vm);
    return vm;
  }

  /* One delegation as a spoken line — screen-reader friendly and used
   * for the visible row's aria-label. */
  function delegationLine(d) {
    const who = [d.department, d.seat && d.seat + " seat",
                 d.engine && d.engine + " engine"]
      .filter(Boolean).join(" · ") || "unattributed hand-off";
    const when = d.createdAt && clock(d.createdAt);
    let tail = d.statusLabel;
    if (d.failure) tail = "failed — " + d.failure;
    return who + " — " + tail + (when ? " (" + when + ")" : "");
  }

  function grantLine(g) {
    const scope = g.scope ? " on " + g.scope : "";
    if (g.active) return g.capability + scope + " — credential ACTIVE";
    const held = Number.isFinite(g.heldSeconds)
      ? ", held " + g.heldSeconds + "s" : "";
    return g.capability + scope + " — issued and revoked" + held;
  }

  function workItemLine(vm) {
    const w = vm.workItem;
    if (!w) return null;
    const name = w.isPrivate ? "private work item"
      : (w.repo || "work item") + (w.pr ? " · PR #" + w.pr : "");
    const bits = [w.verdictLabel];
    if (w.reviewedSha) bits.push("on " + w.reviewedSha);
    if (Number.isFinite(w.round)) bits.push("round " + w.round);
    if (w.merged === true) bits.push("MERGED");
    else if (w.merged === false) bits.push("not merged yet");
    return name + " — " + bits.join(" · ");
  }

  /* DOM renderer. Container ids are fixed in index.html; absent panel
   * (old cached page) is a no-op. */
  function render(doc, observer) {
    const rootEl = doc.getElementById("ops-panel");
    if (!rootEl) return;
    const vm = buildViewModel(observer);
    const set = (id, text) => {
      const n = doc.getElementById(id);
      if (n) n.textContent = text;
    };
    rootEl.dataset.stage = vm.stage || "idle";

    set("ops-stage", vm.stage
      ? "Stage · " + vm.stage
      : "No delegated work item is active");

    const work = doc.getElementById("ops-workitem");
    if (work) {
      work.textContent = workItemLine(vm)
        || "No reviewed work item has been published.";
      work.dataset.tone = vm.workItem ? vm.workItem.verdictTone : "plain";
    }

    const list = doc.getElementById("ops-delegations");
    if (list) {
      list.textContent = "";
      if (!vm.delegations.length) {
        const li = doc.createElement("li");
        li.className = "ops-row is-empty";
        li.textContent = "No recent hand-offs published.";
        list.appendChild(li);
      }
      for (const d of vm.delegations.slice(0, 3)) {
        const li = doc.createElement("li");
        li.className = "ops-row is-" + d.tone;
        li.textContent = delegationLine(d);
        list.appendChild(li);
      }
    }

    const grants = doc.getElementById("ops-grants");
    if (grants) {
      grants.textContent = "";
      if (!vm.grants.length) {
        const li = doc.createElement("li");
        li.className = "ops-row is-empty";
        li.textContent = "No credentials are out.";
        grants.appendChild(li);
      }
      for (const g of vm.grants.slice(0, 2)) {
        const li = doc.createElement("li");
        li.className = "ops-row " + (g.active ? "is-cyan" : "is-quiet");
        li.textContent = grantLine(g);
        grants.appendChild(li);
      }
    }

    set("ops-session", vm.session
      ? ("Session " + vm.session.id
         + (vm.session.active ? " · in progress" : " · closed")
         + (Number.isFinite(vm.session.turns)
             ? " · " + vm.session.turns + " turns" : "")
         + (Number.isFinite(vm.session.costUsd)
             ? " · $" + vm.session.costUsd.toFixed(2) : ""))
      : "No session metadata published.");
  }

  return { buildViewModel, deriveStage, delegationLine, grantLine,
           workItemLine, render };
});
