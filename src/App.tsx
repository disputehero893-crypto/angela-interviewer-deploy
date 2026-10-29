import { useCallback, useEffect, useRef, useState } from "react";
import { Conversation } from "@elevenlabs/client";
import { TalkingAvatar } from "@interviewflowai/talking-avatar";
import {
  ElevenLabsAgentSession,
  AgentEventsEnum,
  type LiveAvatarSession,
} from "@heygen/liveavatar-web-sdk";
import { createAudioTap } from "./audioTap";
import { ROCKETBOX_MORPH_TARGETS } from "./morphTargets";
import {
  requestCandidateMedia,
  startRecorder,
  buildAngelaStream,
  saveInterviewRecording,
  type SideRecorder,
} from "./recording";
import "./App.css";

type Step = "gate" | "consent" | "live" | "done";
type AvatarMode = "portrait" | "3d";
type AvatarProvider = "talking-avatar-oss" | "heygen";

type TranscriptLine = { role: "agent" | "user"; text: string; at: string };

const ANGELA_FACE = "/avatar/angela-face.webp";
const ANGELA_LOOK = "/avatar/angela-look.jpg";
const ANGELA_GLB = "/avatar/angela.glb";

export default function App() {
  const [step, setStep] = useState<Step>("gate");
  const [code, setCode] = useState("");
  const [gateError, setGateError] = useState("");
  const [agentId, setAgentId] = useState("");
  const [avatarProvider, setAvatarProvider] =
    useState<AvatarProvider>("talking-avatar-oss");
  const [consentChecked, setConsentChecked] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [avatarMode, setAvatarMode] = useState<AvatarMode>("portrait");
  const [error, setError] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [position, setPosition] = useState("Behavioral Health Nurse");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [cameraDenied, setCameraDenied] = useState(false);
  const [hasSelfView, setHasSelfView] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingNote, setRecordingNote] = useState("");
  const [interviewRecordId, setInterviewRecordId] = useState<string | null>(
    null,
  );

  const convRef = useRef<AwaitableConversation | null>(null);
  const heygenRef = useRef<LiveAvatarSession | null>(null);
  const avatarRef = useRef<TalkingAvatar | null>(null);
  const avatarMountRef = useRef<HTMLDivElement | null>(null);
  const avatarFrameRef = useRef<HTMLDivElement | null>(null);
  const heygenVideoRef = useRef<HTMLVideoElement | null>(null);
  const selfViewRef = useRef<HTMLVideoElement | null>(null);
  const portraitAudioRef = useRef<HTMLAudioElement | null>(null);
  const analyserCleanupRef = useRef<(() => void) | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const candidateStreamRef = useRef<MediaStream | null>(null);
  const candidateRecorderRef = useRef<SideRecorder | null>(null);
  const angelaRecorderRef = useRef<SideRecorder | null>(null);
  const cameraDeniedRef = useRef(false);

  useEffect(() => {
    return () => {
      void endSession(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (step !== "live") return;
    const stream = candidateStreamRef.current;
    if (stream && selfViewRef.current) {
      selfViewRef.current.srcObject = stream;
      void selfViewRef.current.play().catch(() => {});
    }
  }, [step, hasSelfView]);

  const unlock = async () => {
    setGateError("");
    try {
      const r = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        setGateError(data.error || "Invalid access code");
        return;
      }
      setAgentId(data.agentId);
      if (data.avatarProvider === "heygen" || data.avatarProvider === "talking-avatar-oss") {
        setAvatarProvider(data.avatarProvider);
      }
      setStep("consent");
    } catch (e) {
      setGateError(String((e as Error).message || e));
    }
  };

  const attachPortraitAnalyser = (stream: MediaStream) => {
    analyserCleanupRef.current?.();
    const audio = new Audio();
    audio.srcObject = stream;
    audio.autoplay = true;
    void audio.play().catch(() => {});
    portraitAudioRef.current = audio;

    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    source.connect(ctx.destination);

    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setSpeaking(avg > 18);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    analyserCleanupRef.current = () => {
      cancelAnimationFrame(raf);
      try {
        source.disconnect();
        analyser.disconnect();
        void ctx.close();
      } catch {
        /* ignore */
      }
      audio.pause();
      audio.srcObject = null;
      portraitAudioRef.current = null;
      setSpeaking(false);
    };
  };

  const attach3dAvatar = async (stream: MediaStream) => {
    if (!avatarMountRef.current) return;
    avatarRef.current?.dispose();
    const avatar = new TalkingAvatar({
      container: avatarMountRef.current,
      avatarUrl: ANGELA_GLB,
      morphTargets: ROCKETBOX_MORPH_TARGETS,
      streamDelayMs: 120,
      onError: (err) => console.warn("TalkingAvatar", err),
    });
    await avatar.ready;
    await avatar.attachStream(stream);
    avatarRef.current = avatar;
  };

  const stopSideRecorders = async () => {
    const cand = candidateRecorderRef.current;
    const ang = angelaRecorderRef.current;
    candidateRecorderRef.current = null;
    angelaRecorderRef.current = null;
    setRecording(false);
    const candidateBlob = cand ? await cand.stop() : null;
    const angelaBlob = ang ? await ang.stop() : null;
    return { candidateBlob, angelaBlob };
  };

  const startSideRecorders = () => {
    try {
      if (candidateStreamRef.current && !candidateRecorderRef.current) {
        candidateRecorderRef.current = startRecorder(
          candidateStreamRef.current,
          "candidate",
        );
      }
      const angelaStream = buildAngelaStream({
        videoEl: heygenVideoRef.current,
        frameEl: avatarFrameRef.current,
        agentStream: streamRef.current,
      });
      if (angelaStream && !angelaRecorderRef.current) {
        angelaRecorderRef.current = startRecorder(angelaStream, "angela");
      }
      const active = Boolean(
        candidateRecorderRef.current || angelaRecorderRef.current,
      );
      setRecording(active);
      if (active) {
        setRecordingNote(
          cameraDeniedRef.current
            ? "Recording (camera off — audio/avatar only)"
            : "Recording both sides",
        );
      }
    } catch (e) {
      console.warn("recorder start failed", e);
    }
  };

  const prepareCandidateCamera = async () => {
    const cam = await requestCandidateMedia();
    cameraDeniedRef.current = cam.cameraDenied;
    setCameraDenied(cam.cameraDenied);
    candidateStreamRef.current = cam.stream;
    setHasSelfView(Boolean(cam.stream && cam.stream.getVideoTracks().length));
    if (cam.stream) {
      // Attach after paint so the video element exists in live step
      requestAnimationFrame(() => {
        if (selfViewRef.current) {
          selfViewRef.current.srcObject = cam.stream;
          void selfViewRef.current.play().catch(() => {});
        }
      });
    }
    if (cam.cameraDenied) {
      setRecordingNote(
        cam.stream
          ? "Camera denied — continuing with microphone only"
          : "Camera/mic unavailable — interview continues without candidate recording",
      );
    }
    return cam;
  };

  const fetchAvatarSessionWithRetry = async () => {
    const attempts = 4;
    let lastErr: unknown = null;
    for (let i = 0; i < attempts; i++) {
      try {
        if (i > 0) {
          setStatus(`Waking server… retry ${i + 1}/${attempts}`);
          await new Promise((r) => setTimeout(r, 1500 * i));
        }
        const r = await fetch("/api/avatar/session", { method: "POST" });
        let data: Record<string, unknown> = {};
        try {
          data = await r.json();
        } catch {
          data = {};
        }
        return { r, data };
      } catch (e) {
        // Browser "Failed to fetch" — common on Render free cold starts.
        lastErr = e;
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error("Failed to fetch (server may still be waking — retry in a few seconds)");
  };

  const startHeygenInterview = async () => {
    setError("");
    setStatus("Connecting LiveAvatar…");
    setTranscript([]);
    const { r, data } = await fetchAvatarSessionWithRetry();
    const sessionToken =
      typeof data.sessionToken === "string" ? data.sessionToken : "";
    if (!r.ok || !sessionToken) {
      const detail = (data.detail || {}) as Record<string, unknown>;
      const parts = [
        data.message,
        data.error,
        detail.message,
        data.hint || detail.hint,
      ]
        .map((x) => (typeof x === "string" ? x.trim() : ""))
        .filter(Boolean);
      const uniq = [...new Set(parts)];
      throw new Error(
        uniq.join(" — ") || "Failed to mint LiveAvatar session",
      );
    }

    const session = new ElevenLabsAgentSession(sessionToken, {
      autoKeepAlive: true,
    });
    heygenRef.current = session;

    session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED as never, () => {
      setSpeaking(true);
    });
    session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED as never, () => {
      setSpeaking(false);
    });
    session.on(AgentEventsEnum.AVATAR_TRANSCRIPTION as never, (evt: unknown) => {
      const text = (evt as { text?: string })?.text;
      if (!text) return;
      setTranscript((t) => [
        ...t,
        { role: "agent", text, at: new Date().toISOString() },
      ]);
    });
    session.on(AgentEventsEnum.USER_TRANSCRIPTION as never, (evt: unknown) => {
      const text =
        (evt as { text?: string; data?: { text?: string } })?.text ||
        (evt as { data?: { text?: string } })?.data?.text;
      if (!text) return;
      setTranscript((t) => [
        ...t,
        { role: "user", text, at: new Date().toISOString() },
      ]);
    });
    session.on(
      AgentEventsEnum.ELEVENLABS_AGENT_EVENT as never,
      (evt: unknown) => {
        const e = evt as {
          elevenlabs_event_type?: string;
          data?: { agent_response?: string; user_transcription?: string; text?: string };
        };
        if (e.elevenlabs_event_type === "agent_response" && e.data) {
          const text =
            e.data.agent_response ||
            (e.data as { text?: string }).text ||
            "";
          if (text) {
            setTranscript((t) => [
              ...t,
              { role: "agent", text, at: new Date().toISOString() },
            ]);
          }
        }
        if (e.elevenlabs_event_type === "user_transcript" && e.data) {
          const text =
            (e.data as { user_transcription?: string; text?: string })
              .user_transcription ||
            (e.data as { text?: string }).text ||
            "";
          if (text) {
            setTranscript((t) => [
              ...t,
              { role: "user", text, at: new Date().toISOString() },
            ]);
          }
        }
      },
    );

    setStep("live");
    setStatus("Starting LiveAvatar…");
    // Wait one frame so the <video> mounts before attach()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await session.start();
    if (heygenVideoRef.current) {
      session.attach(heygenVideoRef.current);
    } else {
      console.warn("HeyGen video element missing after mount");
    }
    if (data.sessionId) setConversationId(String(data.sessionId));
    setStatus("Connected — Angela is with you (HeyGen LiveAvatar)");
    // Wait for LiveAvatar media, then start recorders
    window.setTimeout(() => startSideRecorders(), 1500);
    window.setTimeout(() => {
      if (!angelaRecorderRef.current) startSideRecorders();
    }, 4000);
  };

  const startOssInterview = async () => {
    setError("");
    setStatus("Connecting…");
    setTranscript([]);
    const tap = createAudioTap();
    const sessionCfg = await fetch("/api/signed-url").then((r) => r.json());

    const sessionOptions: Record<string, unknown> = {
      onConnect: () => setStatus("Connected — Angela is with you"),
      onDisconnect: () => setStatus("Disconnected"),
      onError: (err: Error) => {
        console.error(err);
        setError(err?.message || "Conversation error");
      },
      onModeChange: (m: { mode?: string }) => {
        if (m?.mode === "speaking") setSpeaking(true);
        if (m?.mode === "listening") setSpeaking(false);
      },
      onMessage: (msg: { source?: string; message?: string }) => {
        if (!msg?.message) return;
        const role = msg.source === "user" ? "user" : "agent";
        setTranscript((t) => [
          ...t,
          { role, text: msg.message!, at: new Date().toISOString() },
        ]);
      },
    };

    if (sessionCfg.mode === "signed" && sessionCfg.signedUrl) {
      sessionOptions.signedUrl = sessionCfg.signedUrl;
    } else {
      sessionOptions.agentId = sessionCfg.agentId || agentId;
    }

    const conv = await Conversation.startSession(
      sessionOptions as Parameters<typeof Conversation.startSession>[0],
    );
    convRef.current = conv as AwaitableConversation;
    try {
      const id = (conv as { getId?: () => string }).getId?.();
      if (id) setConversationId(id);
    } catch {
      /* optional */
    }

    setStep("live");
    setStatus("Live");

    try {
      const stream = await tap.waitForStream();
      streamRef.current = stream;
      if (avatarMode === "3d") {
        await attach3dAvatar(stream);
      } else {
        attachPortraitAnalyser(stream);
      }
    } catch (streamErr) {
      console.warn("Avatar stream tap failed; voice-only fallback", streamErr);
      setStatus("Live (voice — avatar stream unavailable)");
    }
    window.setTimeout(() => startSideRecorders(), 500);
  };

  const startInterview = async () => {
    setError("");
    setInterviewRecordId(null);
    try {
      await prepareCandidateCamera();
      if (avatarProvider === "heygen") {
        await startHeygenInterview();
      } else {
        await startOssInterview();
      }
    } catch (e) {
      setError(String((e as Error).message || e));
      setStatus("Failed to start");
    }
  };

  const switchAvatarMode = async (mode: AvatarMode) => {
    if (avatarProvider === "heygen") return;
    setAvatarMode(mode);
    const stream = streamRef.current;
    if (!stream || step !== "live") return;
    analyserCleanupRef.current?.();
    avatarRef.current?.detachStream();
    avatarRef.current?.dispose();
    avatarRef.current = null;
    if (mode === "3d") {
      await attach3dAvatar(stream);
    } else {
      attachPortraitAnalyser(stream);
    }
  };

  const endSession = useCallback(
    async (save: boolean) => {
      const { candidateBlob, angelaBlob } = await stopSideRecorders();

      analyserCleanupRef.current?.();
      try {
        avatarRef.current?.detachStream();
        avatarRef.current?.dispose();
      } catch {
        /* ignore */
      }
      avatarRef.current = null;
      streamRef.current = null;

      const candStream = candidateStreamRef.current;
      candidateStreamRef.current = null;
      if (candStream) {
        candStream.getTracks().forEach((t) => t.stop());
      }
      if (selfViewRef.current) selfViewRef.current.srcObject = null;

      const heygen = heygenRef.current;
      heygenRef.current = null;
      if (heygen) {
        try {
          await heygen.stop();
        } catch {
          /* ignore */
        }
      }

      const conv = convRef.current;
      convRef.current = null;
      if (conv) {
        try {
          await conv.endSession();
        } catch {
          /* ignore */
        }
      }

      if (save) {
        try {
          const rec = await saveInterviewRecording({
            candidateName: candidateName || "Fictional Candidate",
            position,
            conversationId,
            cameraDenied: cameraDeniedRef.current,
            avatarProvider,
            transcript,
            candidateBlob,
            angelaBlob,
            candidateRecorderStarted: Boolean(candidateBlob),
          });
          if (rec.id) setInterviewRecordId(rec.id);
          if (rec.skipped) {
            setRecordingNote(
              "Recording skipped — storage not configured (live interview still saved locally).",
            );
          } else if (rec.error) {
            setRecordingNote(`Recording save issue: ${rec.error}`);
          } else if (rec.id) {
            setRecordingNote("Both sides saved for review.");
          }
        } catch (e) {
          console.warn("recording save failed", e);
        }

        try {
          await fetch("/api/reports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              candidateName: candidateName || "Fictional Candidate",
              position,
              conversationId,
              transcript,
              summary:
                "Test-mode interview saved locally. Full ElevenLabs analysis (data collection + evaluation criteria) appears on the agent conversation after call end. This draft never ranks, scores, rejects, or hires.",
              consentGiven: true,
              keyResponses: {
                note: "See ElevenLabs conversation analysis fields: licenses_mentioned, experience_summary, crisis_deescalation_notes, meds_safety_notes, teamwork_availability, candidate_questions.",
              },
              verificationNeeded: [],
              humanFollowups: [
                "Human recruiter should review the ElevenLabs transcript and data-collection fields before any next step.",
              ],
              notes: "Fictional test data only. Never auto-reject, rank, score, or hire. Human review only.",
              fictional: true,
              mode: "test",
              avatarProvider,
            }),
          });
        } catch (e) {
          console.warn("report save failed", e);
        }
        setStep("done");
        setStatus("Interview ended");
      }
    },
    [candidateName, position, conversationId, transcript, avatarProvider],
  );

  return (
    <div className="app">
      <header className="top">
        <div>
          <p className="eyebrow">CRS Behavioral Health · Test mode</p>
          <h1>Angela — AI Video Interviewer</h1>
        </div>
        <span className="pill">Unlisted · noindex · fictional data only</span>
      </header>

      {step === "gate" && (
        <section className="card gate">
          <h2>Enter access code</h2>
          <p>
            This private test link is not indexed. Use the CRS test access code
            Derek provided.
          </p>
          <input
            type="password"
            autoComplete="off"
            placeholder="Access code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void unlock()}
          />
          {gateError && <p className="err">{gateError}</p>}
          <button type="button" onClick={() => void unlock()}>
            Continue
          </button>
        </section>
      )}

      {step === "consent" && (
        <section className="card consent">
          <div className="consent-grid">
            <img
              src={ANGELA_LOOK}
              alt="Angela, CRS AI interviewer"
              className="consent-photo"
            />
            <div>
              <h2>Before you begin</h2>
              <p>
                You are about to speak with <strong>Angela</strong>, an AI
                interviewer for CRS Behavioral Health. This is a test-mode
                session using fictional candidate data.
              </p>
              <ul>
                <li>
                  Your voice will be <strong>recorded and transcribed</strong> so
                  a hiring team can review the conversation.
                </li>
                <li>
                  We do <strong>not</strong> use facial recognition or biometric
                  face analysis (Illinois BIPA / AI Video Interview Act).
                </li>
                <li>
                  Angela will not score, rank, reject, or hire you — a human
                  reviews the transcript.
                </li>
                <li>You may stop at any time.</li>
              </ul>
              <p className="muted">
                Avatar:{" "}
                {avatarProvider === "heygen"
                  ? "HeyGen LiveAvatar (Interactive)"
                  : "Talking Avatar OSS"}
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                />
                I consent to this AI video interview being recorded and
                transcribed for hiring review only.
              </label>
              <div className="row">
                <input
                  placeholder="Preferred name (optional)"
                  value={candidateName}
                  onChange={(e) => setCandidateName(e.target.value)}
                />
                <input
                  placeholder="Position"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                />
              </div>
              <button
                type="button"
                disabled={!consentChecked}
                onClick={() => void startInterview()}
              >
                Start interview
              </button>
              {error && <p className="err">{error}</p>}
            </div>
          </div>
        </section>
      )}

      {step === "live" && (
        <section className="live">
          <div className="stage">
            <div
              ref={avatarFrameRef}
              className={`avatar-frame ${speaking ? "speaking" : ""}`}
            >
              {avatarProvider === "heygen" ? (
                <video
                  ref={heygenVideoRef}
                  className="heygen-video"
                  autoPlay
                  playsInline
                />
              ) : avatarMode === "portrait" ? (
                <img src={ANGELA_FACE} alt="Angela" className="portrait" />
              ) : (
                <div ref={avatarMountRef} className="avatar-3d" />
              )}
              <div className="avatar-meta">
                <strong>Angela</strong>
                <span>{speaking ? "Speaking" : "Listening"}</span>
              </div>
              {hasSelfView && (
                <div className="self-view-wrap">
                  <video
                    ref={selfViewRef}
                    className="self-view"
                    autoPlay
                    muted
                    playsInline
                  />
                  <span className="self-view-label">You</span>
                </div>
              )}
            </div>
            <div className="controls">
              <p className="status">{status}</p>
              {recording && <p className="rec-pill">{recordingNote || "Recording"}</p>}
              {!recording && recordingNote && (
                <p className="muted">{recordingNote}</p>
              )}
              {cameraDenied && (
                <p className="muted">
                  Camera not available — continuing without candidate video.
                </p>
              )}
              {avatarProvider !== "heygen" && (
                <div className="mode-toggle">
                  <button
                    type="button"
                    className={avatarMode === "portrait" ? "active" : ""}
                    onClick={() => void switchAvatarMode("portrait")}
                  >
                    Angela look (photoreal still)
                  </button>
                  <button
                    type="button"
                    className={avatarMode === "3d" ? "active" : ""}
                    onClick={() => void switchAvatarMode("3d")}
                  >
                    3D lip-sync (OSS)
                  </button>
                </div>
              )}
              <button
                type="button"
                className="danger"
                onClick={() => void endSession(true)}
              >
                End interview
              </button>
              {error && <p className="err">{error}</p>}
            </div>
          </div>
          <aside className="transcript">
            <h3>Live transcript</h3>
            <div className="lines">
              {transcript.length === 0 && (
                <p className="muted">Waiting for the conversation…</p>
              )}
              {transcript.map((line, i) => (
                <p key={i} className={line.role}>
                  <span>{line.role === "agent" ? "Angela" : "You"}</span>
                  {line.text}
                </p>
              ))}
            </div>
          </aside>
        </section>
      )}

      {step === "done" && (
        <section className="card done">
          <h2>Thank you</h2>
          <p>
            Your test interview has ended. A local report draft was saved for CRS
            review. Angela never auto-rejects or ranks candidates — a human
            follows up.
          </p>
          {recordingNote && <p className="muted">{recordingNote}</p>}
          {interviewRecordId && (
            <p className="muted">
              Recording id: {interviewRecordId} · staff can open{" "}
              <a href="/review">/review</a>
            </p>
          )}
          {conversationId && (
            <p className="muted">Conversation id: {conversationId}</p>
          )}
          <button type="button" onClick={() => window.location.reload()}>
            Start another test
          </button>
        </section>
      )}

      <footer>
        CRS Behavioral Health · Angela interviewer ·{" "}
        {avatarProvider === "heygen"
          ? "HeyGen LiveAvatar + ElevenLabs"
          : "Talking Avatar OSS + ElevenLabs"}{" "}
        · No Indeed integration in this build
      </footer>
    </div>
  );
}

type AwaitableConversation = {
  endSession: () => Promise<void>;
  getId?: () => string;
};
