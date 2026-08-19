(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.StromationTheater) api.install(root.StromationTheater);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clean(value, max) {
    if (value == null) return "";
    return String(value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .trim()
      .slice(0, max || 180);
  }

  function parseHandoff(headline) {
    const match = /^Sol handed this to (.+?):\s*(.+)$/i.exec(headline || "");
    return match ? { role: clean(match[1], 48), task: clean(match[2], 180) } : null;
  }

  function anonymousWorker(index) {
    return {
      id: `public-unidentified-${index}`,
      role: "Unidentified active worker",
      model: null,
      task: "The public state confirms an active worker, but its identity and task are not published.",
      startedAt: null,
      updatedAt: null,
      status: "working",
      inferred: true,
      publicCountBacked: true
    };
  }

  function reconstructWorkers(Core, events, exactCount) {
    const ordered = typeof Core.mergeEvents === "function"
      ? Core.mergeEvents([], events || [])
      : [...(events || [])];
    const open = [];
    const outcomes = [];
    let identityAmbiguous = false;

    function parseDelegated(event) {
      if (typeof Core.parseWorkerDelegation === "function") {
        return Core.parseWorkerDelegation(event);
      }
      const match = /^(.+?) on (.+?) was given work\.?$/i.exec(event.headline || "");
      return {
        role: clean(match && match[1], 48) || "Worker",
        model: clean(match && match[2], 32) || null
      };
    }

    ordered.forEach((event) => {
      if (event.event_type === "worker_delegated") {
        const parsed = parseDelegated(event);
        open.push({
          id: `worker-${event.id}`,
          role: parsed.role || "Worker",
          model: parsed.model || null,
          task: null,
          startedAt: event.ts,
          updatedAt: event.ts,
          status: "working",
          sourceEventId: event.id,
          inferred: false
        });
        return;
      }

      if (event.event_type === "handoff_started") {
        const handoff = parseHandoff(event.headline);
        if (!handoff) return;
        const matches = open.filter((worker) =>
          worker.role && worker.role.toLowerCase() === handoff.role.toLowerCase()
        );
        if (matches.length === 1) {
          matches[0].task = handoff.task;
          matches[0].updatedAt = event.ts;
        } else if (open.length === 1) {
          open[0].task = handoff.task;
          open[0].updatedAt = event.ts;
        }
        return;
      }

      if (event.event_type === "worker_started" || event.event_type === "worker_working") {
        if (open.length === 1) {
          open[0].task = event.headline || open[0].task;
          open[0].updatedAt = event.ts;
        }
        return;
      }

      if (event.event_type === "worker_completed" || event.event_type === "worker_failed") {
        const status = event.event_type === "worker_failed" ? "failed" : "completed";
        if (open.length === 1) {
          const worker = open.shift();
          outcomes.unshift({
            ...worker,
            status,
            endedAt: event.ts,
            result: event.headline
          });
        } else {
          if (open.length > 1) identityAmbiguous = true;
          outcomes.unshift({
            id: `outcome-${event.id}`,
            role: "Worker",
            model: null,
            task: null,
            startedAt: null,
            updatedAt: event.ts,
            status,
            endedAt: event.ts,
            result: event.headline,
            inferred: true
          });
        }
      }
    });

    const numericCount = Number(exactCount);
    const knownExact = exactCount !== null && exactCount !== undefined && exactCount !== "" && Number.isFinite(numericCount) && numericCount >= 0;
    const target = knownExact ? Math.floor(numericCount) : open.length;

    let active = open.slice();
    if (knownExact) {
      if (target === 0) {
        active = [];
      } else if (identityAmbiguous || active.length > target) {
        active = Array.from({ length: target }, (_, index) => anonymousWorker(index + 1));
      } else {
        while (active.length < target) active.push(anonymousWorker(active.length + 1));
      }
    }

    return {
      active,
      outcomes: outcomes.slice(0, 3),
      exactCount: knownExact ? target : null,
      identityAmbiguous
    };
  }

  function install(Core) {
    if (!Core || typeof Core.deriveScene !== "function") return Core;
    if (Core.__truthSceneInstalled) return Core;

    const originalDeriveScene = Core.deriveScene.bind(Core);
    const truthReconstruct = (events, exactCount) => reconstructWorkers(Core, events, exactCount);

    Core.reconstructWorkers = truthReconstruct;
    Core.deriveScene = function deriveScene(events, publicState, options) {
      const scene = originalDeriveScene(events, publicState, options);
      const replay = Boolean(options && options.replay);
      scene.workers = truthReconstruct(
        scene.events,
        replay ? null : publicState && publicState.workers_active
      );
      return scene;
    };
    Core.__truthSceneInstalled = true;
    return Core;
  }

  return { clean, parseHandoff, anonymousWorker, reconstructWorkers, install };
});
