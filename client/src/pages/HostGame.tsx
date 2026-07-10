import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { socket } from "../socket";
import { api, getAdminKey, promptForAdminKey } from "../api";
import AnswerGrid from "../components/AnswerGrid";
import Countdown from "../components/Countdown";
import Leaderboard from "../components/Leaderboard";
import Podium from "../components/Podium";
import type { LobbyState, PodiumPayload, QuestionPayload, RevealPayload } from "../types";

type Phase = "connecting" | "lobby" | "question" | "reveal" | "podium" | "ended";

export default function HostGame() {
  const { quizId } = useParams();
  const [phase, setPhase] = useState<Phase>("connecting");
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [question, setQuestion] = useState<QuestionPayload | null>(null);
  const [reveal, setReveal] = useState<RevealPayload | null>(null);
  const [podium, setPodium] = useState<PodiumPayload | null>(null);
  const [answerCount, setAnswerCount] = useState({ answered: 0, total: 0 });
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [endedReason, setEndedReason] = useState<string | null>(null);

  useEffect(() => {
    const { hostname, origin, port } = window.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      // ריצה מקומית: ה-QR צריך להצביע על כתובת ה-LAN כדי שטלפונים יגיעו
      api.serverInfo().then(({ lanIp }) => {
        const host = lanIp ?? hostname;
        setJoinUrl(`http://${host}${port ? `:${port}` : ""}/join`);
      });
    } else {
      // פריסה באינטרנט: הכתובת הציבורית של האתר
      setJoinUrl(`${origin}/join`);
    }
  }, []);

  useEffect(() => {
    const create = () =>
      socket.emit(
        "host:create",
        { quizId: Number(quizId), adminKey: getAdminKey() },
        (res: LobbyState & { ok: boolean; error?: string; adminRequired?: boolean }) => {
          if (!res.ok) {
            if (res.adminRequired && promptForAdminKey()) {
              create(); // ניסיון חוזר אחרי הזנת סיסמה
              return;
            }
            setError(res.error ?? "יצירת המשחק נכשלה");
            return;
          }
          setLobby(res);
          setPhase("lobby");
        },
      );
    create();

    const onLobby = (state: LobbyState) => setLobby(state);
    const onQuestion = (q: QuestionPayload) => {
      setQuestion(q);
      setReveal(null);
      setAnswerCount({ answered: 0, total: 0 });
      setPhase("question");
    };
    const onReveal = (r: RevealPayload) => {
      setReveal(r);
      setPhase("reveal");
    };
    const onAnswerCount = (c: { answered: number; total: number }) => setAnswerCount(c);
    const onPodium = (p: PodiumPayload) => {
      setPodium(p);
      setPhase("podium");
    };
    const onEnded = ({ reason }: { reason: string | null }) => {
      setEndedReason(reason);
      setPhase("ended");
    };

    socket.on("game:lobby", onLobby);
    socket.on("game:question", onQuestion);
    socket.on("game:reveal", onReveal);
    socket.on("game:answer_count", onAnswerCount);
    socket.on("game:podium", onPodium);
    socket.on("game:ended", onEnded);
    return () => {
      socket.off("game:lobby", onLobby);
      socket.off("game:question", onQuestion);
      socket.off("game:reveal", onReveal);
      socket.off("game:answer_count", onAnswerCount);
      socket.off("game:podium", onPodium);
      socket.off("game:ended", onEnded);
      socket.emit("host:end");
    };
  }, [quizId]);

  if (error) {
    return (
      <div className="center-page">
        <p className="error-text" style={{ fontSize: "1.3rem" }}>{error}</p>
        <Link className="btn btn-secondary" to="/admin">← חזרה לאדמין</Link>
      </div>
    );
  }

  if (phase === "connecting" || !lobby) {
    return <div className="center-page"><div className="spinner" /></div>;
  }

  if (phase === "lobby") {
    const canStart = lobby.questionsReady && lobby.players.length > 0;
    return (
      <div className="center-page">
        <h2>{lobby.quizTitle}</h2>
        <p className="subtitle">הצטרפו בכתובת למטה עם הקוד:</p>
        <div className="lobby-grid">
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.8rem" }}>
            <div className="pin-display">{lobby.pin}</div>
            {joinUrl && <div style={{ direction: "ltr", fontFamily: "monospace", fontSize: "1.1rem" }}>{joinUrl}</div>}
          </div>
          {joinUrl && (
            <div className="qr-box">
              <QRCodeSVG value={`${joinUrl}?pin=${lobby.pin}`} size={170} />
              <span className="join-url">סרקו להצטרפות</span>
            </div>
          )}
        </div>

        {!lobby.questionsReady && !lobby.generationError && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
            <div className="spinner" />
            <span>ה-AI יוצר את השאלות מהחומרים…</span>
          </div>
        )}
        {lobby.questionsReady && (
          <p className="success-text" style={{ color: "#7CFC91" }}>
            ✓ {lobby.questionCount} שאלות מוכנות
          </p>
        )}
        {lobby.generationError && <p className="error-text">{lobby.generationError}</p>}

        <h3>שחקנים ({lobby.players.length})</h3>
        <div className="player-chips">
          {lobby.players.map((name) => (
            <span className="player-chip pop-in" key={name}>{name}</span>
          ))}
          {lobby.players.length === 0 && <span style={{ opacity: 0.7 }}>ממתינים לשחקנים…</span>}
        </div>

        <button className="btn btn-primary btn-big" disabled={!canStart} onClick={() => socket.emit("host:start")}>
          התחלת המשחק ▶
        </button>
      </div>
    );
  }

  if (phase === "question" && question) {
    return (
      <div className="page">
        <div className="question-header">
          <strong>
            שאלה {question.index + 1} / {question.total}
          </strong>
          <Countdown totalMs={question.timeMs} resetKey={question.index} running />
          <strong>
            ענו: {answerCount.answered}
            {answerCount.total ? ` / ${answerCount.total}` : ""}
          </strong>
        </div>
        <div className="question-text">{question.question}</div>
        {question.code && <pre className="code-block">{question.code}</pre>}
        <AnswerGrid options={question.options} disabled />
      </div>
    );
  }

  if (phase === "reveal" && question && reveal) {
    return (
      <div className="page">
        <div className="question-header">
          <strong>
            שאלה {question.index + 1} / {question.total}
          </strong>
          <button className="btn btn-primary" onClick={() => socket.emit("host:next")}>
            {reveal.isLast ? "🏆 לפודיום" : "השאלה הבאה ←"}
          </button>
        </div>
        <div className="question-text">{question.question}</div>
        {question.code && <pre className="code-block">{question.code}</pre>}
        <AnswerGrid options={question.options} correctIndex={reveal.correctIndex} distribution={reveal.distribution} />
        <p style={{ margin: "1rem 0", textAlign: "center", fontSize: "1.1rem" }}>💡 {reveal.explanation}</p>
        <h3 style={{ textAlign: "center", marginBottom: "0.6rem" }}>המובילים</h3>
        <Leaderboard entries={reveal.leaderboard} />
      </div>
    );
  }

  if (phase === "podium" && podium) {
    return (
      <div className="center-page">
        <h1>🏆 הפודיום</h1>
        <Podium ranking={podium.ranking} />
        <Link className="btn btn-secondary" to="/admin">סיום וחזרה לאדמין</Link>
      </div>
    );
  }

  return (
    <div className="center-page">
      <h2>{endedReason ?? "המשחק הסתיים"}</h2>
      <Link className="btn btn-secondary" to="/admin">← חזרה לאדמין</Link>
    </div>
  );
}
