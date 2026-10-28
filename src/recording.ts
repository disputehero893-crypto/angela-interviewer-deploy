/** Browser-side MediaRecorder helpers for Angela interview capture. */

export type SideRecorder = {
  side: "candidate" | "angela";
  stop: () => Promise<Blob | null>;
};

function pickMime(): string | undefined {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "audio/webm;codecs=opus",
    "audio/webm",
  ];
  for (const c of candidates) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(c)
    ) {
      return c;
    }
  }
  return undefined;
}

export function startRecorder(stream: MediaStream, side: "candidate" | "angela"): SideRecorder | null {
  if (!stream || stream.getTracks().length === 0) return null;
  if (typeof MediaRecorder === "undefined") return null;
  const mime = pickMime();
  let recorder: MediaRecorder;
  try {
    recorder = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);
  } catch {
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      return null;
    }
  }
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };
  try {
    recorder.start(1000);
  } catch {
    return null;
  }
  return {
    side,
    stop: () =>
      new Promise((resolve) => {
        const finish = () => {
          const type = recorder.mimeType || mime || "video/webm";
          if (!chunks.length) {
            resolve(null);
            return;
          }
          resolve(new Blob(chunks, { type }));
        };
        if (recorder.state === "inactive") {
          finish();
          return;
        }
        recorder.onstop = () => finish();
        try {
          recorder.stop();
        } catch {
          finish();
        }
      }),
  };
}

export type CameraResult = {
  stream: MediaStream | null;
  cameraDenied: boolean;
  audioOnly: boolean;
};

/** Request camera+mic; fall back to mic-only; then none. */
export async function requestCandidateMedia(): Promise<CameraResult> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { stream: null, cameraDenied: true, audioOnly: false };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: true,
    });
    return { stream, cameraDenied: false, audioOnly: false };
  } catch {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      return { stream, cameraDenied: true, audioOnly: true };
    } catch {
      return { stream: null, cameraDenied: true, audioOnly: false };
    }
  }
}

/**
 * Build an Angela-side stream from the avatar <video> (HeyGen) or a canvas
 * snapshot of the avatar frame plus optional agent audio tracks.
 */
export function buildAngelaStream(opts: {
  videoEl?: HTMLVideoElement | null;
  frameEl?: HTMLElement | null;
  agentStream?: MediaStream | null;
}): MediaStream | null {
  const tracks: MediaStreamTrack[] = [];

  const video = opts.videoEl;
  if (video && typeof (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream === "function") {
    try {
      const vs = (video as HTMLVideoElement & { captureStream: () => MediaStream }).captureStream();
      tracks.push(...vs.getTracks());
    } catch {
      /* ignore */
    }
  }

  if (!tracks.some((t) => t.kind === "video") && opts.frameEl) {
    try {
      const canvas = document.createElement("canvas");
      const rect = opts.frameEl.getBoundingClientRect();
      canvas.width = Math.max(320, Math.floor(rect.width) || 640);
      canvas.height = Math.max(240, Math.floor(rect.height) || 360);
      const ctx = canvas.getContext("2d");
      const draw = () => {
        if (!ctx) return;
        try {
          ctx.fillStyle = "#0b1220";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          // drawImage works for video/img children; otherwise leave solid
          const media = opts.frameEl?.querySelector("video, img") as
            | HTMLVideoElement
            | HTMLImageElement
            | null;
          if (media) {
            ctx.drawImage(media, 0, 0, canvas.width, canvas.height);
          }
        } catch {
          /* ignore */
        }
      };
      draw();
      const cs = (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream?.(15);
      if (cs) {
        // keep drawing while recording
        const iv = window.setInterval(draw, 200);
        cs.getVideoTracks().forEach((t) => {
          t.addEventListener("ended", () => clearInterval(iv));
        });
        tracks.push(...cs.getTracks());
      }
    } catch {
      /* ignore */
    }
  }

  if (opts.agentStream) {
    const haveAudio = tracks.some((t) => t.kind === "audio");
    if (!haveAudio) {
      tracks.push(...opts.agentStream.getAudioTracks().map((t) => t.clone()));
    }
  }

  if (!tracks.length) return null;
  return new MediaStream(tracks);
}

export async function uploadBlob(
  signedUrl: string,
  blob: Blob,
): Promise<void> {
  const r = await fetch(signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": blob.type || "video/webm",
    },
    body: blob,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`upload_failed_${r.status}:${text.slice(0, 120)}`);
  }
}

export async function saveInterviewRecording(opts: {
  candidateName: string;
  position: string;
  conversationId: string | null;
  cameraDenied: boolean;
  avatarProvider: string;
  transcript: { role: string; text: string; at: string }[];
  candidateBlob: Blob | null;
  angelaBlob: Blob | null;
  candidateRecorderStarted: boolean;
}): Promise<{ id: string | null; skipped: boolean; error?: string }> {
  const sides: ("candidate" | "angela")[] = [];
  if (opts.candidateBlob) sides.push("candidate");
  if (opts.angelaBlob) sides.push("angela");
  if (!sides.length && !opts.candidateRecorderStarted) {
    // Nothing to upload — still try to create a metadata-only row if storage is up
  }

  try {
    const createRes = await fetch("/api/interviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateName: opts.candidateName || "Fictional Candidate",
        position: opts.position,
        conversationId: opts.conversationId,
        cameraDenied: opts.cameraDenied,
        avatarProvider: opts.avatarProvider,
        sides: sides.length ? sides : ["candidate"],
      }),
    });
    const createData = await createRes.json();
    if (createRes.status === 503 && createData.error === "storage_not_configured") {
      return { id: null, skipped: true };
    }
    if (!createRes.ok || !createData.id) {
      return {
        id: null,
        skipped: false,
        error: createData.error || "interview_create_failed",
      };
    }

    const uploads = createData.uploads || {};
    let candidatePath: string | null = null;
    let angelaPath: string | null = null;

    if (opts.candidateBlob && uploads.candidate?.signedUrl) {
      await uploadBlob(uploads.candidate.signedUrl, opts.candidateBlob);
      candidatePath = uploads.candidate.path;
    }
    if (opts.angelaBlob && uploads.angela?.signedUrl) {
      await uploadBlob(uploads.angela.signedUrl, opts.angelaBlob);
      angelaPath = uploads.angela.path;
    }

    await fetch(`/api/interviews/${createData.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript: opts.transcript,
        cameraDenied: opts.cameraDenied,
        candidatePath,
        angelaPath,
        conversationId: opts.conversationId,
        avatarProvider: opts.avatarProvider,
        summary:
          "Test-mode interview recording saved. Fictional data only. Human review only — never auto-reject, rank, score, or hire.",
        notes: opts.cameraDenied
          ? "Camera denied or unavailable; audio-only or no candidate video."
          : null,
      }),
    });

    return { id: createData.id, skipped: false };
  } catch (e) {
    return {
      id: null,
      skipped: false,
      error: String((e as Error).message || e),
    };
  }
}
