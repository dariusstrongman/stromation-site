# stromation.com

The static public site for Stromation and its realtime company theater.

## Public routes

- `/` company and offer overview
- `/operations-employee/` the flagship AI Operations Employee offer
- `/workers/` AI employee catalog (Operations available now; future roles labeled not yet available)
- `/growth-operator/` retired — redirects to `/operations-employee/`
- `/custom/` Custom AI Employee (fallback offer)
- `/how-it-works/` employee lifecycle and authority model
- `/live/` realtime public operating record
- `/privacy/`, `/terms/`, `/technology/`, and `/governance/`

Legacy `/watch/` URLs continue to redirect to `/live/`.

## Local verification

The site has no build step. Serve the repository root with any static server,
then run the Node test suite:

```shell
node --test tests/*.test.js
```

GitHub Pages serves production from `main`.

Pull requests to `main` are reviewed by the Gatekeeper and gated on the `site-tests` check.
