import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import {
  mountRecordingRoutes,
  recordingConfigured,
} from "./recording.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dataDir = path.join(root, "data");
const reportsPath = path.join(dataDir, "reports.json");

fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(reportsPath)) fs.writeFileSync(reportsPath, "[]");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const ACCESS_CODE = (process.env.ACCESS_CODE || "CRS-ANGELA-TEST").trim();
const AGENT_ID =
  process.env.ELEVENLABS_AGENT_ID || "agent_9801m624gaj7enj9hj7zd11bqya5";
const ELEVEN_KEY = (process.env.ELEVENLABS_API_KEY || "").trim();
const PORT = Number(process.env.PORT || 4173);

/** Requested provider; live effective provider may fall back to OSS. */
const AVATAR_PROVIDER_REQ = (
  process.env.AVATAR_PROVIDER || "talking-avatar-oss"
).trim();
function stripEnv(value) {
  let v = String(value || "").trim();
  // Render/dashboard pastes sometimes wrap secrets in quotes or include a trailing newline.
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

function resolveLiveAvatarApiKey() {
  // Prefer direct key. Also support hex / split parts so secret-redacting
  // proxies cannot truncate LIVEAVATAR_API_KEY to "[REDACTED]" (10 chars).
  const direct = stripEnv(
    process.env.LIVEAVATAR_API_KEY || process.env.HEYGEN_API_KEY || "",
  );
  if (direct && direct !== "[REDACTED]" && direct.length >= 20) {
    return {
      key: direct,
      source: process.env.LIVEAVATAR_API_KEY
        ? "LIVEAVATAR_API_KEY"
        : "HEYGEN_API_KEY",
    };
  }
  const hex = stripEnv(process.env.LIVEAVATAR_API_KEY_HEX || "");
  if (hex && /^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
    try {
      const key = Buffer.from(hex, "hex").toString("utf8").trim();
      if (key.length >= 20) {
        return { key, source: "LIVEAVATAR_API_KEY_HEX" };
      }
    } catch {
      /* ignore */
    }
  }
  const parts = [
    process.env.LA_KEY_PART1,
    process.env.LA_KEY_PART2,
    process.env.LA_KEY_PART3,
    process.env.LA_KEY_PART4,
  ]
    .map((x) => stripEnv(x || ""))
    .filter(Boolean);
  if (parts.length) {
    const key = parts.join("");
    if (key.length >= 20) {
      return { key, source: "LA_KEY_PART*" };
    }
  }
  return {
    key: direct && direct !== "[REDACTED]" ? direct : "",
    source: direct ? "LIVEAVATAR_API_KEY_OR_ALIAS_SHORT" : null,
  };
}

const _liveAvatarKeyResolved = resolveLiveAvatarApiKey();
const LIVEAVATAR_API_KEY = _liveAvatarKeyResolved.key;
const LIVEAVATAR_KEY_SOURCE = _liveAvatarKeyResolved.source;
const LIVEAVATAR_AVATAR_ID = stripEnv(
  process.env.LIVEAVATAR_AVATAR_ID || process.env.HEYGEN_AVATAR_ID || "",
);
function resolveLiveAvatarElSecretId() {
  const direct = stripEnv(
    process.env.LIVEAVATAR_ELEVENLABS_SECRET_ID ||
      process.env.HEYGEN_ELEVENLABS_SECRET_ID ||
      "",
  );
  if (direct && direct !== "[REDACTED]" && direct.length >= 20) return direct;
  const parts = [
    process.env.LA_EL_SID_PART1,
    process.env.LA_EL_SID_PART2,
    process.env.LA_EL_SID_PART3,
    process.env.LA_EL_SID_PART4,
  ]
    .map((x) => stripEnv(x || ""))
    .filter(Boolean);
  if (parts.length) {
    const joined = parts.join("");
    if (joined.length >= 20) return joined;
  }
  return direct && direct !== "[REDACTED]" ? direct : "";
}
let liveAvatarElSecretId = resolveLiveAvatarElSecretId();
const LIVEAVATAR_SANDBOX =
  String(process.env.LIVEAVATAR_SANDBOX || "").trim().toLowerCase() ===
  "true";

function heygenConfigured() {
  return Boolean(
    LIVEAVATAR_API_KEY &&
      LIVEAVATAR_AVATAR_ID &&
      (liveAvatarElSecretId || ELEVEN_KEY),
  );
}

const SIMLI_API_KEY = stripEnv(process.env.SIMLI_API_KEY || "");
/** Default: Simli preset "Anna" (Trinity-2). Override with custom face from create-simli-face. */
const SIMLI_FACE_ID = stripEnv(
  process.env.SIMLI_FACE_ID || "bf13113a-355a-4d97-8b90-4edccd1da7b2",
);

function simliConfigured() {
  return Boolean(SIMLI_API_KEY && SIMLI_FACE_ID);
}

/** Effective avatar provider for this process. Never force heygen/simli without keys. */
function effectiveAvatarProvider() {
  if (AVATAR_PROVIDER_REQ === "simli" && simliConfigured()) return "simli";
  if (AVATAR_PROVIDER_REQ === "heygen" && heygenConfigured()) return "heygen";
  // Requested simli/heygen without keys → graceful OSS fallback
  return "talking-avatar-oss";
}

/**
 * Probe LiveAvatar auth without logging secret values.
 * Classic HeyGen Interactive keys from app.heygen.com do NOT work here —
 * keys must come from https://app.liveavatar.com/developers.
 */
async function probeLiveAvatarAuth() {
  if (!LIVEAVATAR_API_KEY) {
    return {
      ok: false,
      status: null,
      code: null,
      message: "missing_liveavatar_api_key",
      keySource: LIVEAVATAR_KEY_SOURCE,
      heygenClassicLooksValid: null,
    };
  }
  const headers = {
    "X-API-KEY": LIVEAVATAR_API_KEY,
    accept: "application/json",
  };
  let status = null;
  let code = null;
  let message = null;
  try {
    const r = await fetch("https://api.liveavatar.com/v1/users/credits", {
      method: "GET",
      headers,
    });
    status = r.status;
    const text = await r.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    code = data?.code ?? null;
    message =
      data?.message ||
      (r.ok ? "ok" : `liveavatar_http_${r.status}`);
    // Never include response bodies that might echo secrets; credits payload is fine.
    if (r.ok) {
      return {
        ok: true,
        status,
        code,
        message: "ok",
        keySource: LIVEAVATAR_KEY_SOURCE,
        heygenClassicLooksValid: null,
        creditsRemaining:
          data?.data?.remaining_credits ??
          data?.data?.credit ??
          data?.remaining_credits ??
          null,
      };
    }
  } catch (err) {
    return {
      ok: false,
      status: null,
      code: null,
      message: String(err?.message || err).slice(0, 120),
      keySource: LIVEAVATAR_KEY_SOURCE,
      heygenClassicLooksValid: null,
    };
  }

  // If LiveAvatar rejects the key, check whether it looks like a classic HeyGen key.
  let heygenClassicLooksValid = null;
  try {
    const hr = await fetch("https://api.heygen.com/v2/user/remaining_quota", {
      method: "GET",
      headers: {
        "X-Api-Key": LIVEAVATAR_API_KEY,
        accept: "application/json",
      },
    });
    heygenClassicLooksValid = hr.ok;
  } catch {
    heygenClassicLooksValid = false;
  }

  return {
    ok: false,
    status,
    code,
    message,
    keySource: LIVEAVATAR_KEY_SOURCE,
    heygenClassicLooksValid,
    hint: heygenClassicLooksValid
      ? "This key authenticates to api.heygen.com but NOT api.liveavatar.com. Create a LiveAvatar API key at https://app.liveavatar.com/developers and set LIVEAVATAR_API_KEY (classic HeyGen Interactive keys are not compatible)."
      : "LiveAvatar rejected this API key (Invalid API key). Create/rotate a key at https://app.liveavatar.com/developers and set LIVEAVATAR_API_KEY in Render. Do not use a classic HeyGen video/interactive key.",
  };
}

let liveAvatarAuthCache = { at: 0, value: null };
async function cachedLiveAvatarAuth(force = false) {
  const now = Date.now();
  if (!force && liveAvatarAuthCache.value && now - liveAvatarAuthCache.at < 60_000) {
    return liveAvatarAuthCache.value;
  }
  const value = await probeLiveAvatarAuth();
  liveAvatarAuthCache = { at: now, value };
  return value;
}

function readReports() {
  try {
    return JSON.parse(fs.readFileSync(reportsPath, "utf8"));
  } catch {
    return [];
  }
}

function writeReports(rows) {
  fs.writeFileSync(reportsPath, JSON.stringify(rows, null, 2));
}

app.get("/api/health", async (_req, res) => {
  const provider = effectiveAvatarProvider();
  let liveavatarAuth = null;
  if (LIVEAVATAR_API_KEY) {
    try {
      liveavatarAuth = await cachedLiveAvatarAuth(false);
    } catch {
      liveavatarAuth = { ok: false, message: "probe_failed" };
    }
  }
  res.json({
    ok: true,
    agentConfigured: Boolean(AGENT_ID),
    agentId: AGENT_ID,
    signedUrlReady: Boolean(ELEVEN_KEY),
    avatar: provider,
    avatarRequested: AVATAR_PROVIDER_REQ,
    heygenReady: heygenConfigured(),
    heygenAvatarIdSet: Boolean(LIVEAVATAR_AVATAR_ID),
    heygenKeySet: Boolean(LIVEAVATAR_API_KEY),
    simliReady: simliConfigured(),
    simliKeySet: Boolean(SIMLI_API_KEY),
    simliFaceIdSet: Boolean(SIMLI_FACE_ID),
    simliFaceIdPreview: SIMLI_FACE_ID
      ? `${SIMLI_FACE_ID.slice(0, 8)}…`
      : null,
    liveavatarKeySource: LIVEAVATAR_KEY_SOURCE,
    liveavatarAuthOk: liveavatarAuth ? Boolean(liveavatarAuth.ok) : null,
    liveavatarAuthMessage: liveavatarAuth?.message || null,
    liveavatarAuthHint: liveavatarAuth?.hint || null,
    liveavatarLooksLikeClassicHeygenKey: liveavatarAuth?.heygenClassicLooksValid ?? null,
    liveavatarSandbox: LIVEAVATAR_SANDBOX,
    elevenlabsSecretIdSet: Boolean(liveAvatarElSecretId),
    recordingReady: recordingConfigured(),
    supabaseUrlSet: Boolean((process.env.SUPABASE_URL || "").trim()),
    note:
      "recordingReady=false does not block Start interview; only Supabase upload is disabled.",
  });
});

app.post("/api/access", (req, res) => {
  const code = String(req.body?.code || "").trim();
  if (!code || code !== ACCESS_CODE) {
    return res.status(401).json({ ok: false, error: "Invalid access code" });
  }
  const token = crypto.randomBytes(24).toString("hex");
  res.json({
    ok: true,
    token,
    agentId: AGENT_ID,
    avatarProvider: effectiveAvatarProvider(),
  });
});

app.get("/api/signed-url", async (_req, res) => {
  if (!ELEVEN_KEY) {
    return res.json({
      mode: "public",
      agentId: AGENT_ID,
      message:
        "No ELEVENLABS_API_KEY set; using public agentId. Add the key for signed URLs.",
    });
  }
  try {
    const url = `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(AGENT_ID)}`;
    const r = await fetch(url, {
      headers: { "xi-api-key": ELEVEN_KEY },
    });
    if (!r.ok) {
      const text = await r.text();
      return res
        .status(r.status)
        .json({ error: "signed_url_failed", detail: text });
    }
    const data = await r.json();
    res.json({ mode: "signed", signedUrl: data.signed_url, agentId: AGENT_ID });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/**
 * Ensure LiveAvatar has a stored ElevenLabs API key secret_id.
 * Never logs the key value.
 */
async function ensureElevenLabsSecretId() {
  if (liveAvatarElSecretId) return liveAvatarElSecretId;
  if (!LIVEAVATAR_API_KEY || !ELEVEN_KEY) {
    const err = new Error("heygen_missing_elevenlabs_secret_or_key");
    err.status = 400;
    err.detail = {
      hint: "Set LIVEAVATAR_ELEVENLABS_SECRET_ID (preferred) or ELEVENLABS_API_KEY so the server can register a LiveAvatar secret.",
    };
    throw err;
  }

  const auth = await cachedLiveAvatarAuth(true);
  if (!auth.ok) {
    const err = new Error("heygen_secret_register_failed");
    err.status = auth.status || 401;
    err.detail = {
      code: auth.code,
      message: auth.message,
      keySource: auth.keySource,
      heygenClassicLooksValid: auth.heygenClassicLooksValid,
      hint: auth.hint,
    };
    throw err;
  }

  const r = await fetch("https://api.liveavatar.com/v1/secrets", {
    method: "POST",
    headers: {
      "X-API-KEY": LIVEAVATAR_API_KEY,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      secret_type: "ELEVENLABS_API_KEY",
      secret_value: ELEVEN_KEY,
      secret_name: "Angela ElevenLabs Dispute Hero",
    }),
  });
  const bodyText = await r.text();
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    data = null;
  }
  const secretId =
    data?.data?.secret_id ||
    data?.secret_id ||
    data?.data?.id ||
    data?.id ||
    null;
  if (!r.ok || !secretId) {
    const err = new Error("heygen_secret_register_failed");
    err.status = r.status;
    err.detail = {
      ...(typeof data === "object" && data ? data : { raw: bodyText.slice(0, 200) }),
      hint:
        data?.message === "Invalid API key"
          ? "LiveAvatar API key rejected. Replace LIVEAVATAR_API_KEY with a key from https://app.liveavatar.com/developers (not app.heygen.com)."
          : "LiveAvatar secret registration failed. If ElevenLabs is free-tier, the Agent Connector requires a paid ElevenLabs plan.",
    };
    throw err;
  }
  liveAvatarElSecretId = String(secretId);
  console.log(
    "Registered LiveAvatar ElevenLabs secret_id (value not logged). Persist LIVEAVATAR_ELEVENLABS_SECRET_ID in Render to skip re-register.",
  );
  return liveAvatarElSecretId;
}

/**
 * Mint a LiveAvatar (HeyGen Interactive) session token for LITE + ElevenLabs Agent.
 * Keeps API key on the server; browser only receives session_token.
 */
app.post("/api/avatar/diagnose", async (req, res) => {
  const code = String(req.body?.code || req.headers["x-access-code"] || "").trim();
  if (!code || code !== ACCESS_CODE) {
    return res.status(401).json({ ok: false, error: "Invalid access code" });
  }
  const auth = await cachedLiveAvatarAuth(true);
  res.json({
    ok: true,
    avatar: effectiveAvatarProvider(),
    heygenConfigured: heygenConfigured(),
    simliConfigured: simliConfigured(),
    simliKeySet: Boolean(SIMLI_API_KEY),
    simliFaceIdSet: Boolean(SIMLI_FACE_ID),
    liveavatarKeySet: Boolean(LIVEAVATAR_API_KEY),
    liveavatarKeySource: LIVEAVATAR_KEY_SOURCE,
    liveavatarKeyLength: LIVEAVATAR_API_KEY ? LIVEAVATAR_API_KEY.length : 0,
    avatarIdSet: Boolean(LIVEAVATAR_AVATAR_ID),
    avatarIdLength: LIVEAVATAR_AVATAR_ID ? LIVEAVATAR_AVATAR_ID.length : 0,
    elevenlabsKeySet: Boolean(ELEVEN_KEY),
    elevenlabsSecretIdSet: Boolean(liveAvatarElSecretId),
    sandbox: LIVEAVATAR_SANDBOX,
    auth,
    recordingReady: recordingConfigured(),
    note:
      "recordingReady=false does not block interview start. liveavatarAuthOk must be true before Start interview can mint a session.",
  });
});

app.post("/api/avatar/session", async (_req, res) => {
  if (effectiveAvatarProvider() !== "heygen") {
    return res.status(400).json({
      error: "heygen_not_active",
      avatar: effectiveAvatarProvider(),
      hint: "Set AVATAR_PROVIDER=heygen plus LIVEAVATAR_API_KEY (from app.liveavatar.com/developers — not a classic HeyGen key), LIVEAVATAR_AVATAR_ID, and LIVEAVATAR_ELEVENLABS_SECRET_ID or ELEVENLABS_API_KEY.",
    });
  }
  try {
    const secretId = await ensureElevenLabsSecretId();
    const payload = {
      mode: "LITE",
      avatar_id: LIVEAVATAR_AVATAR_ID,
      elevenlabs_agent_config: {
        secret_id: secretId,
        agent_id: AGENT_ID,
      },
    };
    if (LIVEAVATAR_SANDBOX) {
      // Sandbox ignores production avatar credit use; sessions ~1 min.
      payload.is_sandbox = true;
    }
    const r = await fetch("https://api.liveavatar.com/v1/sessions/token", {
      method: "POST",
      headers: {
        "X-API-KEY": LIVEAVATAR_API_KEY,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const bodyText = await r.text();
    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      data = null;
    }
    const sessionToken =
      data?.data?.session_token ||
      data?.session_token ||
      data?.data?.token ||
      null;
    const sessionId = data?.data?.session_id || data?.session_id || null;
    if (!r.ok || !sessionToken) {
      const msg = data?.message || null;
      return res.status(r.status || 502).json({
        error: "heygen_token_failed",
        message: msg,
        detail: typeof data === "object" ? data : { raw: bodyText.slice(0, 300) },
        hint:
          msg && /credit/i.test(String(msg))
            ? "LiveAvatar needs credits to start a session. Free tier includes 10 credits (~10 LITE minutes). Essential is $99/mo for 1,100 credits. Sandbox: set LIVEAVATAR_SANDBOX=true (Wayne avatar only, ~1 min, no credits)."
            : undefined,
      });
    }
    res.json({
      ok: true,
      provider: "heygen",
      sessionToken,
      sessionId,
      agentId: AGENT_ID,
      sandbox: LIVEAVATAR_SANDBOX,
    });
  } catch (err) {
    const detail = err.detail || undefined;
    const message =
      detail?.message ||
      detail?.hint ||
      String(err?.message || err);
    res.status(err.status || 500).json({
      error: String(err?.message || err),
      message,
      detail,
      hint: detail?.hint,
    });
  }
});

/**
 * Mint a Simli session token (API key stays server-side).
 * Client feeds ElevenLabs agent PCM16 audio into simli-client.
 * Docs: POST https://api.simli.ai/compose/token with x-simli-api-key.
 */
app.post("/api/avatar/simli-session", async (_req, res) => {
  if (!simliConfigured()) {
    return res.status(400).json({
      error: "simli_not_configured",
      avatar: effectiveAvatarProvider(),
      hint: "Set SIMLI_API_KEY (and optional SIMLI_FACE_ID). Free tier: ~50 min/month. Do not put the key in the browser.",
    });
  }
  if (effectiveAvatarProvider() !== "simli" && AVATAR_PROVIDER_REQ !== "simli") {
    // Allow mint when explicitly requested via AVATAR_PROVIDER=simli even if
    // effective fell back (shouldn't happen when configured). Still mint for local tests.
  }
  try {
    const config = {
      faceId: SIMLI_FACE_ID,
      handleSilence: true,
      maxSessionLength: 600,
      maxIdleTime: 180,
      audioInputFormat: "pcm16",
      streaming_width: 768,
      streaming_height: 768,
    };
    const r = await fetch("https://api.simli.ai/compose/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-simli-api-key": SIMLI_API_KEY,
      },
      body: JSON.stringify(config),
    });
    const bodyText = await r.text();
    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      data = null;
    }
    const sessionToken =
      data?.session_token || data?.sessionToken || data?.token || null;
    if (!r.ok || !sessionToken) {
      return res.status(r.status || 502).json({
        error: "simli_token_failed",
        detail:
          typeof data === "object" && data
            ? data
            : { raw: bodyText.slice(0, 300) },
        hint: "Check SIMLI_API_KEY and SIMLI_FACE_ID. Free accounts are limited to ~50 minutes/month.",
      });
    }
    res.json({
      ok: true,
      provider: "simli",
      sessionToken,
      faceId: SIMLI_FACE_ID,
      agentId: AGENT_ID,
      warnings: Array.isArray(data?.warnings) ? data.warnings : [],
    });
  } catch (err) {
    res.status(500).json({
      error: "simli_token_failed",
      message: String(err?.message || err),
    });
  }
});

app.post("/api/reports", (req, res) => {
  const body = req.body || {};
  const report = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    candidateName: body.candidateName || null,
    position: body.position || null,
    conversationId: body.conversationId || null,
    transcript: body.transcript || [],
    summary: body.summary || null,
    keyResponses: body.keyResponses || null,
    verificationNeeded: body.verificationNeeded || null,
    humanFollowups: body.humanFollowups || null,
    consentGiven: body.consentGiven ?? null,
    notes: body.notes || null,
    fictional: true,
    mode: "test",
  };
  const rows = readReports();
  rows.unshift(report);
  writeReports(rows.slice(0, 500));
  res.json({ ok: true, id: report.id });
});

app.get("/api/reports", (req, res) => {
  const key = req.headers["x-admin-key"] || req.query.key;
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  res.json({ reports: readReports() });
});

app.get("/api/reports/:id", (req, res) => {
  const key = req.headers["x-admin-key"] || req.query.key;
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const report = readReports().find((r) => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: "not_found" });
  res.json(report);
});

mountRecordingRoutes(app);

const dist = path.join(root, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
} else {
  app.use(express.static(path.join(root, "public")));
}

app.listen(PORT, () => {
  console.log(
    `Angela interviewer listening on :${PORT} avatar=${effectiveAvatarProvider()}`,
  );
});
