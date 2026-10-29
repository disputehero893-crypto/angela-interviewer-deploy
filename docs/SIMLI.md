# Simli avatar provider

`AVATAR_PROVIDER=simli` uses [Simli](https://docs.simli.com) for photoreal talking-head video driven by the ElevenLabs Angela agent.

## Env

| Var | Required | Notes |
|-----|----------|-------|
| `SIMLI_API_KEY` | yes | Server only. Never `NEXT_PUBLIC_` / browser. |
| `SIMLI_FACE_ID` | optional | Defaults to preset **Anna** (`bf13113a-355a-4d97-8b90-4edccd1da7b2`). |
| `AVATAR_PROVIDER` | — | Set to `simli` only after key + local mint test. Leave Render on `talking-avatar-oss` until then. |

Free plan: ~50 minutes / month. Do not enable paid features without approval.

## Flow

1. Browser posts `/api/avatar/simli-session` → server `POST https://api.simli.ai/compose/token` with `x-simli-api-key`.
2. Client constructs `SimliClient(session_token, video, audio, null)` (LiveKit transport).
3. Client starts ElevenLabs `Conversation` (same consent / transcript / report path as OSS).
4. Agent audio MediaStreamTrack → `simliClient.listenToMediastreamTrack(track)` (pcm16 16 kHz path inside SDK).
5. On mint/start failure → automatic fallback to Talking Avatar OSS.

## Angela custom face

```bash
SIMLI_API_KEY=… node scripts/create-simli-face.mjs
# → set SIMLI_FACE_ID=<face_id> after generation completes (~hours for Trinity-2)
```

If API create is blocked on free tier, keep the Anna preset (or another [Default Face](https://docs.simli.com/api-reference/preset-faces)) until a custom face is available in the Simli web app.

## Local test without switching Render

```bash
SIMLI_API_KEY=… AVATAR_PROVIDER=simli npm run dev
curl -X POST http://127.0.0.1:4173/api/avatar/simli-session
```

Only after a successful mint + short local interview, set Render `AVATAR_PROVIDER=simli` and `SIMLI_API_KEY` / `SIMLI_FACE_ID`.
