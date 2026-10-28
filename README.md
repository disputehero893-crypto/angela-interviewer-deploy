# angela-interviewer-deploy

Public **deploy mirror** of `angela-interviewer` for Render (Render GitHub App cannot fetch private repos on this account).

Source of truth: private repo `disputehero893-crypto/angela-interviewer`.
No API keys or candidate data are included. Access gate + secrets are set in Render env vars.

# Angela — CRS Behavioral Health AI Video Interviewer (TEST)

Private test-mode live interviewer for CRS Behavioral Health nursing candidates.
**Not** Syntalyn. **No Indeed** integration in this build.

## Avatar choice (HeyGen dropped)

| Option | Cost | Latency | Realism | Mobile | Notes |
|--------|------|---------|---------|--------|-------|
| **Talking Avatar Open Source** (chosen) | **$0** MIT | ~120–150 ms stream delay for lip sync | 3D lip-sync; Angela look via photoreal portrait | Yes (WebGL/Web Audio) | Works with any ElevenLabs MediaStream in-browser |
| Talking Avatar Realistic `ava1` Amara | $0.02/min; **$1 free credits** (~50 min), no card for signup | Real-time WebRTC | Photoreal; Amara already matches navy blazer / office / AA woman | Yes | Upgrade path — needs API key signup; **no paid top-up without Derek approval** |
| Tavus CVI | Free 25 min/mo; then ~$0.37/min or $59+/mo | ~500–600 ms | Photoreal replicas | Yes | Heavier stack; would replace/duplicate ElevenLabs voice path |
| Ready Player Me | **Shut down Jan 31, 2026** | — | — | — | Not available |

**Chosen:** Talking Avatar OSS (`@interviewflowai/talking-avatar`) + ElevenLabs agent, with Angela photoreal still (Amara/`angela-look`) as default face and optional Rocketbox GLB 3D lip-sync. No HeyGen. No paid activation required.

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

## Report storage

JSON file at `data/reports.json` (private on host disk). Supabase project deferred — org already has 2 projects; third may bill.
