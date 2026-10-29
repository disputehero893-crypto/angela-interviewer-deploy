/**
 * Simli provider wiring without a live SIMLI_API_KEY.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

async function waitHealth(base, child) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return r.json();
    } catch {
      /* wait */
    }
    if (child.exitCode != null) throw new Error(`server exited ${child.exitCode}`);
    await sleep(100);
  }
  throw new Error("health timeout");
}

function startServer(env, port) {
  return spawn("node", ["server/index.js"], {
    cwd: root,
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("AVATAR_PROVIDER=simli without key falls back to talking-avatar-oss", async () => {
  const port = 4211;
  const base = `http://127.0.0.1:${port}`;
  const child = startServer(
    {
      ACCESS_CODE: "CRS-ANGELA-TEST",
      AVATAR_PROVIDER: "simli",
      SIMLI_API_KEY: "",
      SIMLI_FACE_ID: "",
    },
    port,
  );
  try {
    const health = await waitHealth(base, child);
    assert.equal(health.avatarRequested, "simli");
    assert.equal(health.avatar, "talking-avatar-oss");
    assert.equal(health.simliReady, false);
    assert.equal(health.simliKeySet, false);

    const access = await fetch(`${base}/api/access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "CRS-ANGELA-TEST" }),
    }).then((r) => r.json());
    assert.equal(access.avatarProvider, "talking-avatar-oss");

    const mint = await fetch(`${base}/api/avatar/simli-session`, {
      method: "POST",
    });
    assert.equal(mint.status, 400);
    const body = await mint.json();
    assert.equal(body.error, "simli_not_configured");
  } finally {
    child.kill("SIGTERM");
  }
});

test("AVATAR_PROVIDER=simli with stub key reports simliReady and attempts mint", async () => {
  const port = 4212;
  const base = `http://127.0.0.1:${port}`;
  const child = startServer(
    {
      ACCESS_CODE: "CRS-ANGELA-TEST",
      AVATAR_PROVIDER: "simli",
      // Deliberately invalid — proves server uses key server-side and returns simli_token_failed
      SIMLI_API_KEY: "sk_test_invalid_simli_key_for_unit_test_only",
      SIMLI_FACE_ID: "bf13113a-355a-4d97-8b90-4edccd1da7b2",
    },
    port,
  );
  try {
    const health = await waitHealth(base, child);
    assert.equal(health.avatar, "simli");
    assert.equal(health.simliReady, true);
    assert.equal(health.simliKeySet, true);

    const access = await fetch(`${base}/api/access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "CRS-ANGELA-TEST" }),
    }).then((r) => r.json());
    assert.equal(access.avatarProvider, "simli");

    const mint = await fetch(`${base}/api/avatar/simli-session`, {
      method: "POST",
    });
    // Invalid key → upstream rejection (401/403/etc), not a crash
    assert.ok(mint.status >= 400);
    const body = await mint.json();
    assert.equal(body.error, "simli_token_failed");
    assert.ok(!("sessionToken" in body && body.sessionToken));
  } finally {
    child.kill("SIGTERM");
  }
});

test("default AVATAR_PROVIDER stays talking-avatar-oss (Render must not flip yet)", async () => {
  const port = 4213;
  const base = `http://127.0.0.1:${port}`;
  const child = startServer(
    {
      ACCESS_CODE: "CRS-ANGELA-TEST",
      AVATAR_PROVIDER: "talking-avatar-oss",
    },
    port,
  );
  try {
    const health = await waitHealth(base, child);
    assert.equal(health.avatar, "talking-avatar-oss");
    assert.equal(health.simliReady, false);
  } finally {
    child.kill("SIGTERM");
  }
});
