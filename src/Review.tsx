import { useCallback, useEffect, useState } from "react";
import "./App.css";

type InterviewRow = {
  id: string;
  created_at: string;
  ended_at: string | null;
  candidate_name: string | null;
  position: string | null;
  camera_denied: boolean;
  candidate_path: string | null;
  angela_path: string | null;
  avatar_provider: string | null;
  conversation_id: string | null;
};

type Detail = {
  interview: InterviewRow & {
    transcript?: { role: string; text: string; at: string }[];
    summary?: string | null;
    notes?: string | null;
  };
  playback: { candidate?: string; angela?: string };
};

const ACCESS_KEY = "angela_review_code";

export default function Review() {
  const [code, setCode] = useState(() => sessionStorage.getItem(ACCESS_KEY) || "");
  const [unlocked, setUnlocked] = useState(
    () => Boolean(sessionStorage.getItem(ACCESS_KEY)),
  );
  const [gateError, setGateError] = useState("");
  const [list, setList] = useState<InterviewRow[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [storageOk, setStorageOk] = useState<boolean | null>(null);

  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      "x-access-code": sessionStorage.getItem(ACCESS_KEY) || code,
    }),
    [code],
  );

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
      sessionStorage.setItem(ACCESS_KEY, code);
      setUnlocked(true);
    } catch (e) {
      setGateError(String((e as Error).message || e));
    }
  };

  const loadList = useCallback(async () => {
    setError("");
    try {
      const st = await fetch("/api/recording/status").then((r) => r.json());
      setStorageOk(Boolean(st.configured));
      if (!st.configured) {
        setStatus("Recording storage is not configured yet.");
        setList([]);
        return;
      }
      const r = await fetch("/api/interviews", { headers: headers() });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || "Failed to list interviews");
        return;
      }
      setList(data.interviews || []);
      setStatus(`${(data.interviews || []).length} interview(s)`);
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  }, [headers]);

  useEffect(() => {
    if (unlocked) void loadList();
  }, [unlocked, loadList]);

  const openOne = async (id: string) => {
    setError("");
    setDetail(null);
    try {
      const r = await fetch(`/api/interviews/${id}`, { headers: headers() });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || "Failed to load interview");
        return;
      }
      setDetail(data as Detail);
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  };

  const removeOne = async (id: string) => {
    if (!window.confirm("Delete this interview recording permanently?")) return;
    setError("");
    try {
      const r = await fetch(`/api/interviews/${id}`, {
        method: "DELETE",
        headers: headers(),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || "Delete failed");
        return;
      }
      setDetail(null);
      await loadList();
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  };

  return (
    <div className="app">
      <header className="top">
        <div>
          <p className="eyebrow">CRS Behavioral Health · Test mode</p>
          <h1>Angela — Interview review</h1>
        </div>
        <span className="pill">Staff only · fictional data</span>
      </header>

      {!unlocked && (
        <section className="card gate">
          <h2>Enter access code</h2>
          <p>Same CRS test access code as the interviewer.</p>
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

      {unlocked && (
        <section className="review">
          <div className="review-list card">
            <div className="review-list-head">
              <h2>Recorded interviews</h2>
              <button type="button" onClick={() => void loadList()}>
                Refresh
              </button>
            </div>
            {storageOk === false && (
              <p className="muted">
                Storage not configured. Paste SUPABASE_SERVICE_ROLE_KEY into
                Render, then refresh.
              </p>
            )}
            {status && <p className="muted">{status}</p>}
            {error && <p className="err">{error}</p>}
            <ul className="review-ul">
              {list.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => void openOne(row.id)}
                  >
                    <strong>{row.candidate_name || "Candidate"}</strong>
                    <span>
                      {row.position || "—"} ·{" "}
                      {new Date(row.created_at).toLocaleString()}
                      {row.camera_denied ? " · camera off" : ""}
                    </span>
                  </button>
                </li>
              ))}
              {list.length === 0 && storageOk && (
                <li className="muted">No recordings yet.</li>
              )}
            </ul>
            <p className="muted">
              <a href="/">← Back to interviewer</a>
            </p>
          </div>

          <div className="review-detail card">
            {!detail && (
              <p className="muted">Select an interview to play both sides.</p>
            )}
            {detail && (
              <>
                <div className="review-detail-head">
                  <div>
                    <h2>{detail.interview.candidate_name || "Candidate"}</h2>
                    <p className="muted">
                      {detail.interview.position || "—"} ·{" "}
                      {detail.interview.avatar_provider || "avatar"} · id{" "}
                      {detail.interview.id.slice(0, 8)}…
                    </p>
                  </div>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void removeOne(detail.interview.id)}
                  >
                    Delete
                  </button>
                </div>
                <div className="review-videos">
                  <div>
                    <h3>Candidate</h3>
                    {detail.playback.candidate ? (
                      <video
                        className="review-video"
                        src={detail.playback.candidate}
                        controls
                        playsInline
                      />
                    ) : (
                      <p className="muted">
                        {detail.interview.camera_denied
                          ? "No candidate video (camera denied)."
                          : "No candidate video saved."}
                      </p>
                    )}
                  </div>
                  <div>
                    <h3>Angela</h3>
                    {detail.playback.angela ? (
                      <video
                        className="review-video"
                        src={detail.playback.angela}
                        controls
                        playsInline
                      />
                    ) : (
                      <p className="muted">No Angela video saved.</p>
                    )}
                  </div>
                </div>
                {detail.interview.notes && (
                  <p className="muted">{detail.interview.notes}</p>
                )}
                {Array.isArray(detail.interview.transcript) &&
                  detail.interview.transcript.length > 0 && (
                    <div className="transcript review-transcript">
                      <h3>Transcript</h3>
                      <div className="lines">
                        {detail.interview.transcript.map((line, i) => (
                          <p key={i} className={line.role}>
                            <span>
                              {line.role === "agent" ? "Angela" : "Candidate"}
                            </span>
                            {line.text}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
              </>
            )}
          </div>
        </section>
      )}

      <footer>
        CRS Behavioral Health · Angela interview review · fictional data only
      </footer>
    </div>
  );
}
