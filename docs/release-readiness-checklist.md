# Nexus Dashboard Release Readiness Checklist

Prepared: 2026-06-15
Scope: React dashboard, Express API, Prisma data layer, Socket.IO live updates, agent chat, Mother Chat, boards, approvals, skills, and admin-facing workflows.

## Release Decision

Do not call this dashboard stable until every required gate below is checked or explicitly waived by the release owner.

- [ ] No P0/P1 defects are open.
- [ ] All automated test gates pass on a clean checkout.
- [ ] Manual smoke test passes in a production-like environment.
- [ ] Production environment configuration is reviewed without exposing secrets.
- [ ] Rollback path is documented and tested.
- [ ] Admin signs off on current blockers, residual risks, and release notes.

## Current Repo-Specific Gaps To Close

- [ ] Add or update e2e coverage for the new `/mother-chat` and `/chat` sidebar links. Current navigation coverage checks several links but not these new routes.
- [ ] Add at least one e2e smoke test for Mother Chat: context loads, history renders, sending a prompt creates a user message, and a streamed or fallback assistant response appears.
- [ ] Run all release commands below. This checklist was created from static inspection; command results still need to be recorded.
- [ ] Review `backend/.env.example` before release. It currently contains repeated Codex variables and development admin defaults that must not be enabled in production.
- [ ] Review all uncommitted changes before release, especially new or changed files under `backend/src/services/codex-cli.service.ts`, `backend/src/services/mother-chat.service.ts`, `backend/src/routes/mother-chat.ts`, `frontend/src/pages/MotherChat.tsx`, `frontend/src/pages/Chat.tsx`, and `frontend/src/lib/api.ts`.

## Automated Release Gates

Run from the repository root unless noted.

- [ ] `npm install` completes without lockfile drift.
- [ ] `npm run db:generate -w backend` passes.
- [ ] `npm test -w backend` passes.
- [ ] `npm test -w frontend` passes.
- [ ] `npm run build -w backend` passes.
- [ ] `npm run build -w frontend` passes.
- [ ] `npm run build` passes from the root workspace.
- [ ] Backend starts with production-like env: `npm start -w backend`.
- [ ] Frontend preview starts after build: `npm run preview -w frontend`.
- [ ] E2E suite passes against the running app: `npx playwright test --config e2e/playwright.config.ts`.
- [ ] No `test.only`, `describe.only`, debug sleeps, or temporary console output remain in release code.

## Environment And Deployment Configuration

- [ ] `DATABASE_URL` points to the intended release database.
- [ ] Database backup exists before migrations or deploy.
- [ ] Prisma migrations are applied and verified against a copy of production data.
- [ ] `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `ENCRYPTION_KEY` are production-grade values.
- [ ] `DISABLE_DEV_ADMIN_BOOTSTRAP=true` in production.
- [ ] Development admin credentials are not enabled in production.
- [ ] `CORS_ORIGINS` contains only approved production frontend origins.
- [ ] `APP_URL` matches the production app URL.
- [ ] SMTP settings are validated for signup and email verification.
- [ ] `AGENT_RUNTIME` is intentionally set to `codex-cli` or the intended runtime.
- [ ] Codex CLI diagnostics pass through `/api/mother-chat/diagnostics` for authorized admins.
- [ ] Codex uses existing local CLI login. No OpenAI or Codex API key is requested from users for agent chat.
- [ ] `CODEX_WORKSPACE_ROOT`, sandbox mode, approval policy, and network access are reviewed for the release environment.
- [ ] Logs do not print tokens, cookies, API keys, JWTs, refresh tokens, or raw secret env values.

## Authentication And Session Smoke Tests

- [ ] Unauthenticated users visiting `/dashboard` redirect to `/login`.
- [ ] Authenticated users visiting `/` redirect to `/dashboard`.
- [ ] Login succeeds with a verified account and redirects into the app.
- [ ] Invalid login shows a clear error without leaking auth details.
- [ ] Token refresh works after access token expiration.
- [ ] Expired or invalid refresh state clears auth and returns the user to login.
- [ ] Logout clears auth state and protected routes are no longer accessible.
- [ ] Signup and email verification work if enabled for the release.
- [ ] Organization role and current organization are displayed correctly in the sidebar.

## Dashboard Core Smoke Tests

- [ ] `/dashboard` loads without console errors.
- [ ] Header title and subtitle render.
- [ ] Agent stats render correctly for total, online, idle, errors, events in 1 hour, and active tasks.
- [ ] Empty agent state renders when the organization has no agents.
- [ ] Create Agent call to action navigates to `/agents/new`.
- [ ] Agent cards render avatar, display name, internal name, description, status, heartbeat, last heartbeat, and current task.
- [ ] Clicking an agent card navigates to `/agents/:id`.
- [ ] Recent Activity panel renders the latest activity rows.
- [ ] Recent Activity handles an empty activity list cleanly.
- [ ] Loading states do not leave the dashboard blank.
- [ ] API failures show recoverable UI behavior instead of a hard crash.
- [ ] Dashboard remains usable after a refresh on `/dashboard`.

## Live Update And Socket Tests

- [ ] Socket connects only after auth token is available.
- [ ] Socket joins the correct organization room.
- [ ] `agent:status` updates the matching agent card without a page refresh.
- [ ] `agent:heartbeat` updates status and heartbeat display.
- [ ] `activity:new` appears in the live feed and keeps ordering correct.
- [ ] `task:update` and `task:delete` keep task views consistent.
- [ ] Stats refresh every 30 seconds while the layout is mounted.
- [ ] Navigating between protected pages does not duplicate socket listeners.
- [ ] Disconnect and reconnect behavior does not create duplicate live feed rows.

## Navigation And Page Smoke Tests

- [ ] Sidebar sections render: Monitor, Manage, Observe, Account.
- [ ] Sidebar routes work: Dashboard, Activity Feed, Mother Chat, Chat, Communications, Timeline.
- [ ] Sidebar routes work: Boards, Approvals, Task Board, Network Graph, Agent Controls, Gateways.
- [ ] Sidebar routes work: Skills, Soul Templates, Custom Fields, Metrics and Cost, Alerts, Search and Audit, Settings.
- [ ] Active route styling is correct after direct URL load and link navigation.
- [ ] Sidebar remains usable at desktop and tablet widths.
- [ ] Logout button is keyboard accessible and has an accessible label or title.
- [ ] Public docs pages remain accessible without auth.

## Agent And Chat Workflows

- [ ] Create agent succeeds with required fields.
- [ ] Edit agent persists changes and refreshes the dashboard card.
- [ ] Agent profile loads for an existing agent.
- [ ] Agent profile handles missing or unauthorized agents gracefully.
- [ ] Standard `/chat` loads agents and chat history.
- [ ] Sending an agent chat message persists the user message.
- [ ] Assistant response appears through streaming or fallback response.
- [ ] Chat history survives page refresh.
- [ ] Failed chat requests show a visible error and allow retry.
- [ ] Agent status and activity updates reflect chat execution.

## Mother Chat Workflow

- [ ] `/mother-chat` loads context and history for an authenticated user.
- [ ] Context snapshot shows counts for agents, running sessions, active tasks, recent errors, pending approvals, and token usage.
- [ ] Hidden `__mother_chat__` system agent is not shown as a normal dashboard agent.
- [ ] Sending an empty message is blocked client-side and rejected server-side with 400.
- [ ] Sending a valid message creates a visible user message immediately.
- [ ] Socket `mother-chat:event` response chunks append to the same assistant message for the request.
- [ ] `response_end` clears sending state and refreshes context.
- [ ] Error events render a visible assistant error and clear sending state.
- [ ] History includes prior Mother Chat turns after refresh.
- [ ] Codex resume recovery works when a saved session is stale.
- [ ] Terminal output, file read/write, and tool call events do not leak secrets.
- [ ] Long responses remain readable and do not break the layout.
- [ ] Mother Chat is org-scoped and cannot read another organization's records.

## Boards, Tasks, And Approvals

- [ ] Boards list loads.
- [ ] Board detail loads by id and handles missing boards.
- [ ] Create, edit, and delete board flows work if enabled.
- [ ] Task board loads columns and task cards.
- [ ] Add task modal validates required fields.
- [ ] Drag and drop status changes persist.
- [ ] Custom fields render and save correctly on tasks.
- [ ] Approval list loads pending and resolved approvals.
- [ ] Approval decision actions persist and update related task state.
- [ ] Policy rules prevent unauthorized status changes where configured.

## Admin Feature Smoke Tests

- [ ] Skills marketplace loads available skills and assigned skills.
- [ ] Soul templates list, create, edit, and assignment flows work.
- [ ] Custom field definitions can be created, edited, and applied.
- [ ] Gateways list loads and health checks complete.
- [ ] Gateway create and edit validate URL/token/workspace fields.
- [ ] Metrics page renders response time, success rate, token, and cost data.
- [ ] Alerts page renders rules and events.
- [ ] Alert acknowledgment persists.
- [ ] Search and audit page returns expected activity results.
- [ ] Settings page loads organization and account data.
- [ ] Invitations flow works for valid and invalid emails.

## API And Data Integrity Tests

- [ ] Every protected `/api/*` route used by the dashboard returns 401 without auth.
- [ ] Authenticated routes enforce organization isolation.
- [ ] Role-restricted operations reject unauthorized roles.
- [ ] Request validation rejects malformed payloads with useful 4xx errors.
- [ ] Prisma unique, foreign key, and not-found errors map to safe API responses.
- [ ] Pagination and limits work for activity, sessions, history, metrics, and search endpoints.
- [ ] Large activity histories do not time out or over-fetch.
- [ ] Webhook and remote-agent routes remain protected by their intended auth mode.
- [ ] Deleting agents, boards, tasks, skills, and custom fields does not orphan visible dashboard records.

## Security And Privacy

- [ ] HTTP-only refresh cookie is set with production-safe attributes.
- [ ] Access token is not written to persistent browser storage.
- [ ] CORS blocks unapproved origins.
- [ ] Helmet security headers are present.
- [ ] Rate limits protect login, signup, and high-cost agent endpoints.
- [ ] Chat and activity content is rendered as text, not executable HTML.
- [ ] User-supplied names, descriptions, task titles, and messages cannot execute scripts.
- [ ] Error messages do not disclose stack traces or internal paths in production.
- [ ] Production logs avoid secret env values, auth headers, cookies, and raw tokens.
- [ ] Dev-only endpoints or credentials are disabled in production.

## Accessibility And UX

- [ ] All interactive controls are keyboard reachable.
- [ ] Focus states are visible on sidebar links, buttons, textareas, and modal controls.
- [ ] Icon-only buttons have titles or accessible names.
- [ ] Form errors are visible near the relevant fields.
- [ ] Loading and disabled states are clear for long-running actions.
- [ ] Text does not overlap or clip at 390px, 768px, 1024px, and 1440px widths.
- [ ] Dashboard cards and stat tiles stay within their containers.
- [ ] Color contrast is acceptable for status text, errors, disabled states, and links.
- [ ] Empty, loading, success, and error states are covered for the primary pages.

## Performance And Reliability

- [ ] Initial dashboard load is acceptable on seeded production-like data.
- [ ] Repeated navigation does not increase event listener count.
- [ ] Long-running Codex requests time out predictably and release UI sending state.
- [ ] API failures leave the user with retry options.
- [ ] Backend startup resets stuck online agents as expected.
- [ ] Gateway auto-connect behavior is correct for the selected runtime.
- [ ] Frontend build output has no unexpectedly large chunks requiring action.
- [ ] No unbounded polling or retry loops are present.

## Release Evidence To Attach

- [ ] Command log for all automated gates.
- [ ] Playwright HTML report or CI artifact.
- [ ] Browser screenshots for dashboard, Mother Chat, boards, metrics, and alerts.
- [ ] Database migration output.
- [ ] Production config review confirmation without secret values.
- [ ] Known issues list with severity and owner.
- [ ] Rollback procedure and restore verification.

## Go/No-Go Template

Release status: `NO-GO` until all required gates are checked.

Completed work:
- 

Current work:
- 

Blockers:
- 

Risks:
- 

Recommended next step:
- Run the automated release gates, then execute the manual smoke sections for Dashboard, Mother Chat, auth, live sockets, and admin workflows.
