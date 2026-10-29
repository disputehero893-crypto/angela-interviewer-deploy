#!/usr/bin/env node
/**
 * Create a Simli Trinity-2 face from public/avatar/angela-look.jpg.
 * Requires SIMLI_API_KEY. Uses free-tier face generation API only (no paid SKUs).
 * Generation can take hours; poll with the returned face_id.
 *
 * Usage: SIMLI_API_KEY=… node scripts/create-simli-face.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const key = (process.env.SIMLI_API_KEY || "").trim();
const imagePath =
  process.env.SIMLI_FACE_IMAGE ||
  path.join(root, "public/avatar/angela-look.jpg");

if (!key) {
  console.error("SIMLI_API_KEY is not set — cannot create a face.");
  process.exit(2);
}
if (!fs.existsSync(imagePath)) {
  console.error("Image not found:", imagePath);
  process.exit(2);
}

const form = new FormData();
const buf = fs.readFileSync(imagePath);
form.append(
  "image",
  new Blob([buf], { type: "image/jpeg" }),
  path.basename(imagePath),
);

const url = new URL("https://api.simli.ai/faces/trinity");
url.searchParams.set("face_name", "Angela-CRS");
url.searchParams.set("gsVersion", "GSA_2.0");

console.log("POST", url.toString(), "image=", imagePath, "bytes=", buf.length);
const r = await fetch(url, {
  method: "POST",
  headers: { "x-simli-api-key": key },
  body: form,
});
const text = await r.text();
let data;
try {
  data = JSON.parse(text);
} catch {
  data = { raw: text.slice(0, 500) };
}
console.log("status", r.status);
console.log(JSON.stringify(data, null, 2));
if (!r.ok) {
  console.error(
    "Face create failed. Free tier may be out of Trinity-2 generations, or the plan blocks API create — use a Default Face id from docs (e.g. Anna bf13113a-355a-4d97-8b90-4edccd1da7b2) as SIMLI_FACE_ID.",
  );
  process.exit(1);
}
const faceId = data.face_id || data.faceId;
if (faceId) {
  console.log("\nSet SIMLI_FACE_ID=%s (poll generation_status until ready; Trinity-2 often ~4h).", faceId);
}
