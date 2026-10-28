# Angela deliverable notes (2026-10-28 CT)

## Avatar option chosen

**Talking Avatar Open Source** (`@interviewflowai/talking-avatar`, MIT, **$0**)

### Why
- Derek barred HeyGen.
- Free forever, no API key, browser-only lip sync from ElevenLabs MediaStream.
- Mobile-capable (WebGL 2 + AudioWorklet).
- Pairs cleanly with ElevenLabs ConvAI (tap audio element → mute EL playback → attachStream / portrait analyser).

### Angela look
- Default UI: photoreal Angela still matching spec (African American woman ~35, navy blazer, modern office) — Talking Avatar stock **Amara (`ava1`)** face + generated Angela portrait.
- Optional toggle: Rocketbox 3D GLB lip-sync (OSS) with Oculus viseme morph map.

### Costs
| Item | Cost |
|------|------|
| Talking Avatar OSS | $0 |
| ElevenLabs agent (existing workspace usage) | per plan |
| Render free web | $0 (when GitHub app can see private repo) |
| Realistic Amara upgrade | $0.02/min; $1 free credits (~50 min), no card for signup — **needs approval before any paid top-up**; custom face $199 |

### Alternatives researched
- **Tavus CVI:** free 25 min/mo, then ~$0.37/min or $59+/mo; ~500–600 ms; photoreal; heavier / overlaps voice stack.
- **Talking Avatar Realistic:** best photoreal match is already Amara (navy blazer/office); deferred paid path.
- **Ready Player Me:** shut down 2026-01-31.

## ElevenLabs
- Connected MCP account is Dispute Hero — original `agent_1501m623t21dfjjsfvcyz02w8bfz` **404**.
- Created replacement: `agent_9801m624gaj7enj9hj7zd11bqya5` (Bella voice, gemini-2.5-flash, flash_v2 TTS, 45 min max, post-call fields, no hire scores).

## App
- Private repo: https://github.com/disputehero893-crypto/angela-interviewer
- Access code: `CRS-ANGELA-TEST`
- Temporary tunnel (box): see parent report
- Render: private repo not fetchable by Render GitHub app until repo access is granted; Blueprint: https://dashboard.render.com/blueprint/new?repo=https://github.com/disputehero893-crypto/angela-interviewer

## Still blocked / needs Derek
1. Connect CRS ElevenLabs workspace (or confirm using Dispute Hero agent above).
2. Grant Render GitHub App access to `angela-interviewer` (or approve public deploy mirror).
3. Optional: `ELEVENLABS_API_KEY` env for signed URLs; Realistic Amara API key if upgrading photoreal video.
4. No Indeed yet (per brief).
