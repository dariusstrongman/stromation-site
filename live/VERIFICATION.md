# Stromation Live verification notes

This change is intentionally constrained to the public projection layer.

## Data boundary

- `live/live.js` remains the only script that queries the full public timeline and state.
- Work-conversation grouping now reads only rows already rendered in `#event-feed`; it opens no second Supabase client and makes no additional database queries.
- The Main Stage truth shim consumes only the same `public_events` and `public_state.workers_active` values already supplied to the scene engine.
- No private table, prompt, reasoning record, customer record, secret, or write path is added.

## Accuracy rules

- A lifecycle event is attached to a named worker only when there is exactly one eligible worker, or a handoff role uniquely matches one open worker.
- When multiple worker identities are possible, the UI does not guess which worker completed or received an unlabelled lifecycle event.
- If `public_state.workers_active` proves that workers are active but public events do not prove their identities, the stage shows explicitly unidentified active-worker cards rather than assigning unsupported names or tasks.
- Replay conversations are built from the replay rows currently rendered on screen, so a replay frame cannot reveal a later worker return before that return event is present.

## Asset-path hardening

All Live-owned CSS and JS references use `/live/...` absolute paths. This keeps the real page correct and also makes visual verification deterministic when an HTML renderer injects a different `<base>` URL.

## Viewer behavior

There is one chronological Company feed. Worker handoffs and council exchanges are grouped inline where their source events occur, while ordinary company events remain normal feed rows.
