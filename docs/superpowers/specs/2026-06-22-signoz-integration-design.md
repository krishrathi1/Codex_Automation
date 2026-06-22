# SigNoz Integration — Design

**Date:** 2026-06-22
**Status:** Approved (Phase 1)

## Goal

Let Nexus read the **production website's** runtime logs from SigNoz so that (a) a
human can view them in a new **Logs** tab, and (b) production `ERROR`/`FATAL`
logs automatically feed the existing auto-fix pipeline
(`ingestProductionErrorEvent` → debug → review → GitHub push → Vercel redeploy).

The production website is the Next.js app hosted on Vercel
(`krishrathi1/Mutual-Fund-Co-Pilot-`). SigNoz captures its live runtime errors,
which the current sources (Vercel deploy failures, GitHub Action failures) miss.

## Scope decomposition

1. **SigNoz instance** — self-hosted via Docker Compose (the repo provided). Infra.
2. **Website → SigNoz telemetry** — OpenTelemetry instrumentation in the
   Mutual-Fund-Co-Pilot repo. *Separate repo; follow-up.*
3. **Nexus ↔ SigNoz** — settings, Logs tab, error source. **This phase, this repo.**

Hard constraint: a SigNoz on `localhost` is unreachable from Vercel. For the real
production path SigNoz must be public (SigNoz Cloud, or self-host + Cloudflare
tunnel). This does not change Nexus code — only the configured endpoint URL.

## Phase 1 — Nexus-side integration (this repo)

### A. Connection config
- Store a SigNoz provider in encrypted org integration settings, mirroring the
  existing GitHub/Vercel pattern in `platform-integrations.service.ts`:
  - `endpoint` (query API base URL, e.g. `http://localhost:8080` self-host or the
    SigNoz Cloud region URL) and `apiKey` (sent as `SIGNOZ-API-KEY` header).
- Extend `updateIntegrationSettings` / `sanitizeProvider` / route schema and the
  Settings → Integrations UI with a **SigNoz** card (endpoint + API key + Check).
- `getMonitorIntegrationCredentials` returns `signoz: { endpoint, apiKey }`
  (settings first, env fallback `SIGNOZ_ENDPOINT` / `SIGNOZ_API_KEY`).

### B. SigNoz service (`backend/src/services/signoz-api.service.ts`)
- `SigNozConfig { endpoint, apiKey }`.
- `isSigNozConfigured(cfg)` — `Boolean(cfg?.endpoint && cfg?.apiKey)`.
- `queryLogs(cfg, { severity?, search?, sinceMs, limit })` — calls SigNoz logs
  query API (`POST /api/v3/query_range`, builder query over the `logs` source,
  filtered by `severity_text`), returns normalized
  `SigNozLog { timestamp, severity, body, serviceName, traceId?, attributes }[]`.
- Defensive: non-OK responses log a warning and return `[]` (never throw into the
  monitor loop).

### C. Logs viewer
- API: `GET /api/signoz/logs?severity=&search=&sinceMs=&limit=` (requireAuth) →
  `queryLogs` with the org's SigNoz creds.
- Frontend: new **Logs** route/nav item + page. Severity filter (ERROR/WARN/INFO/
  ALL), text search, time window, refresh. Read-only list styled like the Activity
  feed. Empty/--not-configured-- states point to Settings.

### D. SigNoz error source → auto-fix
- `checkSigNozErrors(orgId, cfg)` in `mutual-fund-monitor.service.ts`, sibling to
  `checkVercelErrors`: query `ERROR`/`FATAL` logs in the last interval, fingerprint
  by `serviceName + normalized message`, and for each new one call
  `ingestProductionErrorEvent(orgId, { source: 'signoz', severity, title, message,
  stack, payload })`. Gated by `isSigNozConfigured`. Dedup reuses the pipeline's
  existing in-flight fingerprint guard.
- Wire into `runCheck()` next to the Vercel/GitHub checks.

## Prerequisite fix — pipeline `DEBUG_QUEUED` stall

Observed: a real Vercel deploy failure was ingested, the Debug agent completed with
a full fix, but the event stayed at `DEBUG_QUEUED` and never advanced to
review→commit→push. Root cause: the agent-run worker **overwrites the job's
`contextPacket`** with its own `nexus_agent_run_context`, so
`advanceProductionErrorPipelineAfterJob` sees `source !== 'production_error_pipeline'`
and bails. The event's `taskId` was also `null`.

Fix direction: persist the pipeline markers (`productionErrorEventId`,
`pipelineRole`, `pipelineAttempt`) somewhere the worker does not clobber — either
preserve/merge the original `contextPacket` instead of replacing it, or resolve the
pipeline context from the `ProductionErrorEvent` row via the job's id
(`debugRunJobId`/`reviewRunJobId`/`commitRunJobId`) rather than the packet. Verify a
debug-complete advances to review→commit and that an API push fires. Without this,
SigNoz-sourced errors will not reach GitHub either.

## Out of scope (follow-ups)
- Standing up production-grade / public SigNoz (Cloud or tunnel).
- Instrumenting the Mutual-Fund-Co-Pilot Next.js app with OpenTelemetry.
- Traces/metrics views (logs only for Phase 1).

## Testing / verification
- Stand up self-hosted SigNoz via Docker; seed a sample `ERROR` log via OTLP.
- `Check` button validates creds; Logs tab renders the seeded log.
- Pipeline-stall fix: confirm a debug-complete advances and an API push occurs.
- SigNoz source: seed an `ERROR` log → confirm `ingestProductionErrorEvent` fires
  and the event flows through to a GitHub commit.
