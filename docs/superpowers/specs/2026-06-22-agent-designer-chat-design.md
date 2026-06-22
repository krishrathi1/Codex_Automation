# In-Modal Agent Designer Chat — Design

**Date:** 2026-06-22
**Status:** Approved (user confirmed core decisions)

## Problem

The "New Production Group" modal ([Dashboard.tsx](../../../frontend/src/pages/Dashboard.tsx) → `CreateProductionGroupModal`)
is a plain form. The user wants a chat interface taking ~50% of the modal where they
describe what kind of agents they want, an assistant asks clarifying questions, and only
after that does the group + its agents get created.

## Approved decisions

1. **Chat outcome:** the assistant *designs the agents* — it interviews the user, then
   proposes a roster of sub-agents (each with a display name, role, and persona/soul).
2. **Finalize flow:** *review then create* — proposed agents appear as editable cards; the
   user can tweak/remove/add, and nothing is created until they click **Create**.
3. **Backend brain:** a new `agent-designer` endpoint backed by the existing Claude CLI
   runtime (the same one Mother Chat uses). No board is required to run it.

## Architecture

### Backend

**`backend/src/services/agent-designer.service.ts`**
- `designAgents({ organizationId, messages })` where `messages: { role: 'user' | 'assistant'; content: string }[]`.
- Validates Claude CLI installation + auth (reuse `validateInstallation` / `validateAuthentication`).
- `cwd = resolveClaudeCwd()` (no agent → project root).
- Builds a prompt = a fixed **system instruction block** + the conversation transcript.
  The conversation is **stateless / ephemeral**: the full transcript is embedded in each
  prompt (conversations are short), so no Claude session resume and no DB persistence.
- The system instructions tell the model to:
  - Ask **one** clarifying question at a time until it understands the goal.
  - When (and only when) it has enough, emit a single fenced ` ```json ` block matching the
    **Proposal schema** below, preceded by a short human-readable summary line.
- Runs `runClaudeCliPromptWithResumeRecovery({ command, cwd, prompt, onEvent })` with a
  no-op `onEvent` (request/response, no streaming for v1).
- Parses the model output: extract the JSON block if present → `proposal`; the remaining
  text (block stripped) → `reply`. Returns `{ reply, proposal? }`. Malformed JSON →
  treat as a normal `reply` with no proposal (degrade gracefully).

**Proposal schema** (what the model emits, what the UI consumes):
```json
{
  "group": { "name": "string", "objective": "string", "description": "string",
             "mode": "continuous|sprint|goal", "maxAgents": 5 },
  "agents": [
    { "displayName": "string", "role": "string (short)", "persona": "string (soul/system prompt)" }
  ]
}
```

**`backend/src/routes/agent-designer.ts`**
- `POST /message` → body `{ messages }` → calls `designAgents` → returns `{ reply, proposal }`.
- Errors carry `statusCode` (503 for CLI unavailable, 400 for bad input) like Mother Chat.
- Registered in `index.ts`: `app.use('/api/agent-designer', requireAuth, agentDesignerRoutes)`.

### Frontend (`CreateProductionGroupModal` in Dashboard.tsx)

- **Layout:** widen modal `max-w-xl` → `~max-w-5xl`; two columns (`md:grid-cols-2`).
  - **Left — Agent Designer chat:** greeting, scrollable message list, textarea + send.
    State: `chatMessages`, `chatInput`, `chatBusy`. Send → `api.agentDesigner.message(messages)`.
  - **Right — group form** (existing fields) **+ "Proposed agents" section.**
- When a response includes a `proposal`:
  - Auto-fill the group fields (`name`, `objective`, `description`, `boardType`, `maxAgents`)
    *only where the user hasn't already typed something* (don't clobber manual edits).
  - Render `proposal.agents` as **editable cards** (`displayName`, `role`, `persona`) held in
    `proposedAgents` state. Each card: edit fields inline + remove button; plus an "Add agent" button.
- **Create flow** (`handleSubmit` → parent `handleCreate`):
  1. Create the board (existing `api.boards.create`).
  2. For each proposed agent: `api.agents.create({ name, displayName, description: role, soulMd: persona, enabled: true })`
     then `api.boards.addAgent(board.id, { agentId })`. `name` = slugified unique displayName.
  3. Navigate to the new board as today. Partial-failure: surface an error listing which
     agents failed but keep the created board.

### API client (`frontend/src/lib/api.ts`)

```ts
agentDesigner: {
  message: (messages: { role: 'user' | 'assistant'; content: string }[]) =>
    request<{ reply: string; proposal?: AgentDesignProposal }>(
      '/agent-designer/message', { method: 'POST', body: JSON.stringify({ messages }) }),
}
```

## Out of scope (YAGNI)

- Streaming token-by-token responses (v1 is request/response).
- Persisting/resuming the design conversation across modal opens.
- Editing the group's connected resources from chat (kept as manual form fields).

## Testing

- Backend: unit-test the proposal parser (JSON block extraction, malformed → reply-only).
- Manual smoke: open modal, chat ("monitor my Vercel deploy and auto-fix"), confirm the
  assistant asks questions, then proposes agents; edit a card; Create; verify board +
  agents exist and agents are attached to the board.
