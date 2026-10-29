# Angela — CRS Behavioral Health AI Video Interviewer (TEST)

Private test-mode live interviewer for CRS Behavioral Health nursing candidates.
**Not** Syntalyn. **No Indeed** integration in this build.

## Avatar providers

- `talking-avatar-oss` (default / live on Render) — photoreal still + optional 3D lip-sync
- `simli` — Simli Trinity video + ElevenLabs audio (`docs/SIMLI.md`). Requires `SIMLI_API_KEY`. Do not flip Render until local mint passes.
- `heygen` — LiveAvatar (unused while OSS/simli preferred)


## Avatar choice (HeyGen dropped)

| Option | Cost | Latency | Realism | Mobile | Notes |
|--------|------|---------|---------|--------|-------|
| **Talking Avatar Open Source** (chosen) | **$0** MIT | ~120–150 ms stream delay for lip sync | 3D lip-sync; Angela look via photoreal portrait | Yes (WebGL/Web Audio) | Works with any ElevenLabs MediaStream in-browser |
| Talking Avatar Realistic `ava1` Amara | $0.02/min; **$1 free credits** (~50 min), no card for signup | Real-time WebRTC | Photoreal; Amara already matches navy blazer / office / AA woman | Yes | Upgrade path — needs API key signup; **no paid top-up without Derek approval** |
| Tavus CVI | Free 25 min/mo; then ~$0.37/min or $59+/mo | ~500–600 ms | Photoreal replicas | Yes | Heavier stack; would replace/duplicate ElevenLabs voice path |
| Ready Player Me | **Shut down Jan 31, 2026** | — | — | — | Not available |

**Chosen (live):** Talking Avatar OSS (`@interviewflowai/talking-avatar`) + ElevenLabs agent, with Angela photoreal still (Amara/`angela-look`) as default face and optional Rocketbox GLB 3D lip-sync. No HeyGen. No paid activation required.

## ElevenLabs agent

- **New agent on connected Dispute Hero workspace:** `agent_9801m624gaj7enj9hj7zd11bqya5`
- Original brief id `agent_1501m623t21dfjjsfvcyz02w8bfz` was **not found** in this ElevenLabs account (404). CRS’s ElevenLabs workspace is not the connected MCP account.
- Voice: Bella (`hpp4J3VqNfWAUOO0d1Us`), LLM: `gemini-2.5-flash`, TTS: `eleven_flash_v2`, max 45 minutes.
- Post-call data collection + compliance evaluation criteria configured (no hire scores).

## Test access

- Access code (default): `CRS-ANGELA-TEST`
- Pages send `noindex,nofollow`
- Fictional candidates only

## Run locally

```bash
cp .env.example .env
# optional: ELEVENLABS_API_KEY=... for signed URLs
npm install
npm run build
npm start
# open http://localhost:4173
```

Dev (Vite + API): `npm run dev` (API on :4173, Vite on :5173).

## Env

| Var | Purpose |
|-----|---------|
| `ACCESS_CODE` | Gate code |
| `ELEVENLABS_AGENT_ID` | Angela agent id |
| `ELEVENLABS_API_KEY` | Signed URL minting (optional if agent auth is off) |
| `ADMIN_KEY` | Read saved reports |


## Interview recording (optional)

After consent + **Start interview**, the browser asks for camera + mic, shows a self-view, and records the candidate plus Angela’s avatar side with `MediaRecorder`. If the camera is denied, the interview continues (audio-only / no candidate video) and the row is marked `camera_denied`.

Videos land in the free Supabase project’s private `angela-interviews` bucket (schema `angela.interviews`). Staff review is at **`/review`** (same access code). Without storage env vars, live interviews still work; recording APIs return `storage_not_configured`.

| Var | Purpose |
|-----|---------|
| `SUPABASE_URL` | Project URL (non-secret) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only; paste in Render yourself — never commit |

## Report storage

JSON file at `data/reports.json` (private on host disk). Supabase project deferred — org already has 2 projects; third may bill.
