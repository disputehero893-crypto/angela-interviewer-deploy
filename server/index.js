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
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY || "";
const PORT = Number(process.env.PORT || 4173);

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
  res.json({
    ok: true,
    agentConfigured: Boolean(AGENT_ID),
    signedUrlReady: Boolean(ELEVEN_KEY),
    avatar: "talking-avatar-oss",
  });
});

app.post("/api/access", (req, res) => {
  const code = String(req.body?.code || "").trim();
  if (!code || code !== ACCESS_CODE) {
    return res.status(401).json({ ok: false, error: "Invalid access code" });
  }
  const token = crypto.randomBytes(24).toString("hex");
  res.json({ ok: true, token, agentId: AGENT_ID });
});

app.get("/api/signed-url", async (req, res) => {
  if (!ELEVEN_KEY) {
    // Public agent mode (auth disabled on agent): client can use agentId directly.
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
      return res.status(r.status).json({ error: "signed_url_failed", detail: text });
    }
    const data = await r.json();
    res.json({ mode: "signed", signedUrl: data.signed_url, agentId: AGENT_ID });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
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
  console.log(`Angela interviewer listening on :${PORT}`);
});
