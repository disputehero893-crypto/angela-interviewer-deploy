# Anam avatar provider

`AVATAR_PROVIDER=anam` uses [Anam](https://anam.ai/docs/integrations/elevenlabs/agents) Cara video with the CRS ElevenLabs Conversational agent (agent_1501). The browser talks only to Anam (`@anam-ai/js-sdk`); Anam owns mic capture and agent audio — do **not** start a second ElevenLabs `Conversation` session in the browser.

## Env

| Var | Required | Notes |
| --- | --- | --- |
| `ANAM_API_KEY` or `ANAM_KEY_PART1`…`PART4` | yes | Server only. Split parts avoid secret-redacting proxies. |
| `ANAM_AVATAR_ID` | yes | Angela CRS avatar `3ac87b47-a610-48a5-95fa-dc83c2e031a7` |
| `ANAM_AVATAR_MODEL` | optional | Default `cara-4.1-express` (free plan) |
| `AVATAR_PROVIDER` | — | Set `anam` after keys are live |
| `ELEVENLABS_API_KEY` / `EL_KEY_PART*` | yes | Mint EL signed URL server-side |
| Simli vars | fallback | Kept configured; client falls back to Simli if Anam mint/start fails |

## Flow

1. Browser `POST /api/avatar/anam-session`
2. Server fetches EL signed URL, then `POST https://api.anam.ai/v1/auth/session-token` with `environment.elevenLabsAgentSettings`
3. Client `createClient(sessionToken)` → `streamToVideoElement('anam-avatar-video')`
4. Transcript from Anam `MESSAGE_STREAM_EVENT_RECEIVED`; optional EL conversation fetch via `/api/elevenlabs/conversation/:id`

Landing / consent still uses `public/avatar/angela-look.jpg` when provider is `anam`.
