import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

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
const LIVEAVATAR_API_KEY = (
  process.env.LIVEAVATAR_API_KEY ||
  process.env.HEYGEN_API_KEY ||
  ""
).trim();
const LIVEAVATAR_AVATAR_ID = (
  process.env.LIVEAVATAR_AVATAR_ID ||
  process.env.HEYGEN_AVATAR_ID ||
  ""
).trim();
let liveAvatarElSecretId = (
  process.env.LIVEAVATAR_ELEVENLABS_SECRET_ID ||
  process.env.HEYGEN_ELEVENLABS_SECRET_ID ||
  ""
).trim();

function heygenConfigured() {
  return Boolean(
    LIVEAVATAR_API_KEY &&
      LIVEAVATAR_AVATAR_ID &&
      (liveAvatarElSecretId || ELEVEN_KEY),
  );
}

/** Effective avatar provider for this process. Never force heygen without keys. */
function effectiveAvatarProvider() {
  if (AVATAR_PROVIDER_REQ === "heygen" && heygenConfigured()) return "heygen";
  return "talking-avatar-oss";
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

app.get("/api/health", (_req, res) => {
  const provider = effectiveAvatarProvider();
  res.json({
    ok: true,
    agentConfigured: Boolean(AGENT_ID),
    signedUrlReady: Boolean(ELEVEN_KEY),
    avatar: provider,
    avatarRequested: AVATAR_PROVIDER_REQ,
    heygenReady: heygenConfigured(),
    heygenAvatarIdSet: Boolean(LIVEAVATAR_AVATAR_ID),
    heygenKeySet: Boolean(LIVEAVATAR_API_KEY),
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
    throw new Error("heygen_missing_elevenlabs_secret_or_key");
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
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
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
    err.detail = typeof data === "object" ? data : { raw: text.slice(0, 200) };
    throw err;
  }
  liveAvatarElSecretId = String(secretId);
  return liveAvatarElSecretId;
}

/**
 * Mint a LiveAvatar (HeyGen Interactive) session token for LITE + ElevenLabs Agent.
 * Keeps API key on the server; browser only receives session_token.
 */
app.post("/api/avatar/session", async (_req, res) => {
  if (effectiveAvatarProvider() !== "heygen") {
    return res.status(400).json({
      error: "heygen_not_active",
      avatar: effectiveAvatarProvider(),
      hint: "Set AVATAR_PROVIDER=heygen plus LIVEAVATAR_API_KEY (or HEYGEN_API_KEY), LIVEAVATAR_AVATAR_ID, and LIVEAVATAR_ELEVENLABS_SECRET_ID or ELEVENLABS_API_KEY.",
    });
  }
  try {
    const secretId = await ensureElevenLabsSecretId();
    const r = await fetch("https://api.liveavatar.com/v1/sessions/token", {
      method: "POST",
      headers: {
        "X-API-KEY": LIVEAVATAR_API_KEY,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "LITE",
        avatar_id: LIVEAVATAR_AVATAR_ID,
        elevenlabs_agent_config: {
          secret_id: secretId,
          agent_id: AGENT_ID,
        },
      }),
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
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
      return res.status(r.status || 502).json({
        error: "heygen_token_failed",
        detail: typeof data === "object" ? data : { raw: text.slice(0, 300) },
      });
    }
    res.json({
      ok: true,
      provider: "heygen",
      sessionToken,
      sessionId,
      agentId: AGENT_ID,
    });
  } catch (err) {
    res.status(err.status || 500).json({
      error: String(err?.message || err),
      detail: err.detail || undefined,
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
