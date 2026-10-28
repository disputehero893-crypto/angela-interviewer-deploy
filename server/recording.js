/**
 * Interview recording storage helpers (Supabase).
 * SUPABASE_SERVICE_ROLE_KEY must never be logged or returned to clients.
 */
import { createClient } from "@supabase/supabase-js";

const BUCKET = "angela-interviews";
const SCHEMA = "angela";

export function recordingConfigured() {
  const url = (process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return Boolean(url && key);
}

function getAdminClient() {
  const url = (process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: SCHEMA },
  });
}

function storageNotConfigured(res) {
  return res.status(503).json({
    error: "storage_not_configured",
    message:
      "Interview recording storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Live interviews still work without recording.",
  });
}

function staffAuthorized(req) {
  const access = String(
    req.headers["x-access-code"] || req.query.code || req.body?.code || "",
  ).trim();
  const admin = String(
    req.headers["x-admin-key"] || req.query.key || "",
  ).trim();
  const ACCESS_CODE = (process.env.ACCESS_CODE || "CRS-ANGELA-TEST").trim();
  const ADMIN_KEY = (process.env.ADMIN_KEY || "").trim();
  if (access && access === ACCESS_CODE) return true;
  if (ADMIN_KEY && admin && admin === ADMIN_KEY) return true;
  return false;
}

function objectPath(interviewId, side, ext = "webm") {
  return `${interviewId}/${side}.${ext}`;
}

export function mountRecordingRoutes(app) {
  app.get("/api/recording/status", (_req, res) => {
    res.json({
      configured: recordingConfigured(),
      bucket: BUCKET,
    });
  });

  /** Create interview row + signed upload URLs for candidate/angela videos. */
  app.post("/api/interviews", async (req, res) => {
    if (!recordingConfigured()) return storageNotConfigured(res);
    const sb = getAdminClient();
    const body = req.body || {};
    const candidateName = body.candidateName || "Fictional Candidate";
    const position = body.position || null;
    const conversationId = body.conversationId || null;
    const cameraDenied = Boolean(body.cameraDenied);
    const avatarProvider = body.avatarProvider || null;
    const sides = Array.isArray(body.sides)
      ? body.sides.filter((s) => s === "candidate" || s === "angela")
      : ["candidate", "angela"];

    try {
      const { data: row, error } = await sb
        .from("interviews")
        .insert({
          candidate_name: candidateName,
          position,
          conversation_id: conversationId,
          consent_given: true,
          consent_text_version: "v1-existing-checkbox",
          camera_denied: cameraDenied,
          fictional: true,
          mode: "test",
          avatar_provider: avatarProvider,
        })
        .select("id, created_at")
        .single();
      if (error || !row) {
        return res.status(502).json({
          error: "interview_create_failed",
          detail: error?.message || "unknown",
        });
      }

      const uploads = {};
      for (const side of sides) {
        const path = objectPath(row.id, side, "webm");
        const { data: signed, error: signErr } = await sb.storage
          .from(BUCKET)
          .createSignedUploadUrl(path);
        if (signErr || !signed?.signedUrl) {
          return res.status(502).json({
            error: "upload_url_failed",
            side,
            detail: signErr?.message || "no signed url",
          });
        }
        uploads[side] = {
          path,
          signedUrl: signed.signedUrl,
          token: signed.token || null,
        };
      }

      res.json({
        ok: true,
        id: row.id,
        createdAt: row.created_at,
        uploads,
      });
    } catch (err) {
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  /** Mark interview complete after client uploads blobs. */
  app.patch("/api/interviews/:id", async (req, res) => {
    if (!recordingConfigured()) return storageNotConfigured(res);
    const sb = getAdminClient();
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "missing_id" });
    const body = req.body || {};

    const patch = {
      ended_at: body.endedAt || new Date().toISOString(),
      transcript: Array.isArray(body.transcript) ? body.transcript : undefined,
      summary: body.summary ?? undefined,
      notes: body.notes ?? undefined,
      camera_denied:
        typeof body.cameraDenied === "boolean" ? body.cameraDenied : undefined,
      candidate_path: body.candidatePath ?? undefined,
      angela_path: body.angelaPath ?? undefined,
      conversation_id: body.conversationId ?? undefined,
      avatar_provider: body.avatarProvider ?? undefined,
    };
    // Drop undefined keys
    for (const k of Object.keys(patch)) {
      if (patch[k] === undefined) delete patch[k];
    }

    try {
      const { data, error } = await sb
        .from("interviews")
        .update(patch)
        .eq("id", id)
        .is("deleted_at", null)
        .select(
          "id, ended_at, candidate_path, angela_path, camera_denied, conversation_id",
        )
        .maybeSingle();
      if (error) {
        return res.status(502).json({
          error: "interview_update_failed",
          detail: error.message,
        });
      }
      if (!data) return res.status(404).json({ error: "not_found" });
      res.json({ ok: true, interview: data });
    } catch (err) {
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  /** Staff list — access code or admin key. */
  app.get("/api/interviews", async (req, res) => {
    if (!staffAuthorized(req)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (!recordingConfigured()) return storageNotConfigured(res);
    const sb = getAdminClient();
    try {
      const { data, error } = await sb
        .from("interviews")
        .select(
          "id, created_at, ended_at, candidate_name, position, camera_denied, candidate_path, angela_path, avatar_provider, conversation_id, fictional, mode",
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) {
        return res.status(502).json({
          error: "interview_list_failed",
          detail: error.message,
        });
      }
      res.json({ interviews: data || [] });
    } catch (err) {
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  /** Staff detail + signed playback URLs. */
  app.get("/api/interviews/:id", async (req, res) => {
    if (!staffAuthorized(req)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (!recordingConfigured()) return storageNotConfigured(res);
    const sb = getAdminClient();
    const id = String(req.params.id || "").trim();
    try {
      const { data, error } = await sb
        .from("interviews")
        .select("*")
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) {
        return res.status(502).json({
          error: "interview_get_failed",
          detail: error.message,
        });
      }
      if (!data) return res.status(404).json({ error: "not_found" });

      const playback = {};
      for (const [key, path] of [
        ["candidate", data.candidate_path],
        ["angela", data.angela_path],
      ]) {
        if (!path) continue;
        const { data: signed, error: signErr } = await sb.storage
          .from(BUCKET)
          .createSignedUrl(path, 60 * 60);
        if (!signErr && signed?.signedUrl) {
          playback[key] = signed.signedUrl;
        }
      }
      res.json({ interview: data, playback });
    } catch (err) {
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  /** Soft-delete + remove storage objects. */
  app.delete("/api/interviews/:id", async (req, res) => {
    if (!staffAuthorized(req)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (!recordingConfigured()) return storageNotConfigured(res);
    const sb = getAdminClient();
    const id = String(req.params.id || "").trim();
    try {
      const { data, error } = await sb
        .from("interviews")
        .select("id, candidate_path, angela_path, composite_path")
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) {
        return res.status(502).json({
          error: "interview_delete_failed",
          detail: error.message,
        });
      }
      if (!data) return res.status(404).json({ error: "not_found" });

      const paths = [data.candidate_path, data.angela_path, data.composite_path]
        .filter(Boolean);
      if (paths.length) {
        await sb.storage.from(BUCKET).remove(paths);
      }
      // Also try conventional paths in case metadata was incomplete
      await sb.storage.from(BUCKET).remove([
        objectPath(id, "candidate"),
        objectPath(id, "angela"),
      ]);

      const { error: updErr } = await sb
        .from("interviews")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (updErr) {
        return res.status(502).json({
          error: "interview_delete_failed",
          detail: updErr.message,
        });
      }
      res.json({ ok: true, id });
    } catch (err) {
      res.status(500).json({ error: String(err?.message || err) });
    }
  });
}
