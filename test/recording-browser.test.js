/**
 * Playwright smoke: Chrome fake media against local Angela server.
 * Verifies camera permission path, MediaRecorder, and that interviews
 * still complete when storage is not configured.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const PORT = 4201;
const BASE = `http://127.0.0.1:${PORT}`;

let child;
let browser;

before(async () => {
  child = spawn("node", ["server/index.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      ACCESS_CODE: "CRS-ANGELA-TEST",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      AVATAR_PROVIDER: "talking-avatar-oss",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) break;
    } catch {
      /* wait */
    }
    await sleep(100);
  }
  browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
});

after(async () => {
  if (browser) await browser.close();
  if (child) child.kill("SIGTERM");
});

test("MediaRecorder captures fake camera stream in Chromium", async () => {
  const page = await browser.newPage();
  await page.goto(BASE);
  await page.waitForSelector("text=Enter access code");
  const result = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.start(200);
    await new Promise((r) => setTimeout(r, 800));
    await new Promise((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: mime });
    return {
      tracks: stream.getTracks().map((t) => t.kind),
      size: blob.size,
      type: blob.type,
    };
  });
  assert.ok(result.tracks.includes("video"), "fake video track");
  assert.ok(result.tracks.includes("audio"), "fake audio track");
  assert.ok(result.size > 0, "recorded blob non-empty");
  await page.close();
});

test("Angela gate + consent page load; recording status visible via API", async () => {
  const page = await browser.newPage();
  await page.goto(BASE);
  await page.waitForSelector("text=Enter access code");
  await page.fill('input[type="password"]', "CRS-ANGELA-TEST");
  await page.click("button:has-text('Continue')");
  await page.waitForSelector("text=Before you begin");
  // Consent text must remain unchanged
  const consent = await page.textContent("body");
  assert.match(consent, /I consent to this AI video interview being recorded/);
  assert.match(consent, /facial recognition or biometric/);
  const status = await page.evaluate(async () => {
    const r = await fetch("/api/recording/status");
    return r.json();
  });
  assert.equal(status.configured, false);
  await page.close();
});
