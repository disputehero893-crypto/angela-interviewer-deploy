import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;

let child;

before(async () => {
  child = spawn("node", ["server/index.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      ACCESS_CODE: "CRS-ANGELA-TEST",
      // Intentionally omit SUPABASE_* to verify graceful degradation
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      AVATAR_PROVIDER: "talking-avatar-oss",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {
      /* wait */
    }
    await sleep(100);
  }
  assert.equal(ready, true, "server should start");
});

after(() => {
  if (child) child.kill("SIGTERM");
});

test("health reports recordingReady false without supabase keys", async () => {
  const r = await fetch(`${BASE}/api/health`);
  const data = await r.json();
  assert.equal(data.ok, true);
  assert.equal(data.recordingReady, false);
});

test("POST /api/interviews returns storage_not_configured without keys", async () => {
  const r = await fetch(`${BASE}/api/interviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      candidateName: "Test Candidate",
      position: "Behavioral Health Nurse",
      cameraDenied: false,
      sides: ["candidate"],
    }),
  });
  assert.equal(r.status, 503);
  const data = await r.json();
  assert.equal(data.error, "storage_not_configured");
});

test("GET /api/interviews unauthorized without access code", async () => {
  const r = await fetch(`${BASE}/api/interviews`);
  assert.equal(r.status, 401);
});

test("GET /api/interviews with access code still storage_not_configured", async () => {
  const r = await fetch(`${BASE}/api/interviews`, {
    headers: { "x-access-code": "CRS-ANGELA-TEST" },
  });
  assert.equal(r.status, 503);
  const data = await r.json();
  assert.equal(data.error, "storage_not_configured");
});

test("recording status endpoint", async () => {
  const r = await fetch(`${BASE}/api/recording/status`);
  const data = await r.json();
  assert.equal(data.configured, false);
  assert.equal(data.bucket, "angela-interviews");
});

test("access gate still works", async () => {
  const r = await fetch(`${BASE}/api/access`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "CRS-ANGELA-TEST" }),
  });
  const data = await r.json();
  assert.equal(r.status, 200);
  assert.equal(data.ok, true);
});
