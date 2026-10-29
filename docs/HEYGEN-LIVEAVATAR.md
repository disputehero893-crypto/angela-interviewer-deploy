# HeyGen LiveAvatar (Interactive) — Angela

## What "separate type of HeyGen" means

Derek (voice, 2026-10-28 ~4:58 PM CT) asked for a **separate type of HeyGen, not the regular one**.

That product is **HeyGen LiveAvatar** (formerly Interactive / Streaming Avatar):

- Product: https://www.liveavatar.com/
- Docs: https://docs.liveavatar.com/
- Help: https://help.heygen.com/en/articles/12758516-introducing-liveavatar
- Distinct from regular HeyGen **pre-recorded video** avatars; separate credits and app (`app.liveavatar.com`).
- Avatars made in classic HeyGen are **not** cross-compatible with LiveAvatar.

Evidence in transcripts:

- Interviewer's original CRS brief (Derek, ~3:47 PM CT) said a HeyGen avatar named Angela already existed and Interviewer planned LiveAvatar / Interactive Avatar + ElevenLabs.
- Later that afternoon Derek told Interviewer **not** to use HeyGen and to pick a free alternative → Talking Avatar OSS shipped.
- At ~4:58 PM CT Derek asked Ricky Bobby to connect the separate HeyGen type for Angela's avatar.

**Not the same thing:** `@interviewflowai/talking-avatar`'s `LiveAvatar` class is InterviewFlowAI's **Realistic Avatars** product ($0.02/min). It shares the name "LiveAvatar" but is **not** HeyGen.

## Integration in this repo

- Env flag: `AVATAR_PROVIDER=heygen` (default remains `talking-avatar-oss`).
- Server mints a LITE-mode session token via `POST https://api.liveavatar.com/v1/sessions/token` using `LIVEAVATAR_API_KEY` / `HEYGEN_API_KEY`.
- Browser uses `@heygen/liveavatar-web-sdk` `ElevenLabsAgentSession` so **ElevenLabs stays the voice + brain**; LiveAvatar renders lip-synced video.
- Requires: LiveAvatar API key, LiveAvatar `avatar_id`, and either `LIVEAVATAR_ELEVENLABS_SECRET_ID` or `ELEVENLABS_API_KEY` (server can register the secret once).
- ElevenLabs Agent Connector needs a **paid** ElevenLabs plan (free-tier keys are blocked by ElevenLabs for third-party connectors). Agent audio should be PCM 24 kHz.

## Pricing (LiveAvatar, independent of HeyGen video)

| Tier | Price | Credits / month |
|------|-------|-----------------|
| Free | $0 | 10 (no overage) |
| Essential | $99 | 1,100 |
| Business | $475 | 6,000 |

LITE (Avatar Only) = **1 credit per minute**. Free tier ≈ 10 minutes/month. No signup/spend by agents without Derek's yes.

## Going live checklist

1. Derek creates/logs into https://app.liveavatar.com (same HeyGen login works).
2. Create or pick a LiveAvatar `avatar_id` (classic HeyGen Angela look may need re-creation).
3. Put in Render env (never commit): `LIVEAVATAR_API_KEY`, `LIVEAVATAR_AVATAR_ID`, and either `LIVEAVATAR_ELEVENLABS_SECRET_ID` or `ELEVENLABS_API_KEY`.
4. Only then set `AVATAR_PROVIDER=heygen`. Without keys the server stays on OSS so the site does not break.


## Troubleshooting (2026-10-29)

### `heygen_secret_register_failed` / `Invalid API key`

LiveAvatar (`api.liveavatar.com`) rejected the configured key. Common cause: a **classic HeyGen** API key from `app.heygen.com` was pasted into `HEYGEN_API_KEY` / `LIVEAVATAR_API_KEY`. LiveAvatar keys are separate — create one at **https://app.liveavatar.com/developers** and set `LIVEAVATAR_API_KEY` in Render (prefer that name over the HEYGEN_ alias).

Check without exposing secrets:

```bash
curl -sS -X POST https://angela-interviewer.onrender.com/api/avatar/diagnose \
  -H 'Content-Type: application/json' \
  -d '{"code":"CRS-ANGELA-TEST"}'
```

Look for `auth.ok`, `auth.heygenClassicLooksValid`, and `auth.hint`. `/api/health` also reports `liveavatarAuthOk`.

### First click `Failed to fetch`

Render free tier cold-starts. Logs around 2026-10-29 16:37 UTC showed `npm start` while the browser hit Start interview. The client now retries `/api/avatar/session` a few times. If it still fails, wait ~30s and retry.

### `recordingReady: false`

Missing `SUPABASE_SERVICE_ROLE_KEY` (URL alone is not enough). **Does not block** Start interview — only interview video upload/review is disabled.

### Credits / paid plan

- LiveAvatar Free: $0 / 10 credits/mo (LITE = 1 credit/min). Essential $99 / 1,100 credits. Sessions cannot start with 0 credits unless `LIVEAVATAR_SANDBOX=true` (Wayne avatar only, ~1 min, no credits).
- ElevenLabs Agent Connector requires a **paid** ElevenLabs plan (free-tier keys are blocked for third-party connectors).
