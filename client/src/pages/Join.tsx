import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { socket } from "../socket";
import AnswerGrid from "../components/AnswerGrid";
import Countdown from "../components/Countdown";
import type { PlayerResultPayload, PodiumPayload, QuestionPayload } from "../types";

type Phase = "form" | "lobby" | "question" | "waiting" | "result" | "podium" | "ended";

export default function Join() {
  const [searchParams] = useSearchParams();
  const [phase, setPhase] = useState<Phase>("form");
  const [pin, setPin] = useState(searchParams.get("pin") ?? "");
  const [name, setName] = useState("");
  const [quizTitle, setQuizTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState<QuestionPayload | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<PlayerResultPayload | null>(null);
  const [finalRank, setFinalRank] = useState<{ rank: number; score: number; total: number } | null>(null);
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const myName = useRef("");

  useEffect(() => {
    const onQuestion = (q: QuestionPayload) => {
      setQuestion(q);
      setSelected(null);
      setResult(null);
      setPhase("question");
    };
    const onResult = (r: PlayerResultPayload) => {
      setResult(r);
      setPhase("result");
    };
    const onPodium = (p: PodiumPayload) => {
      setPhase("podium");
      setFinalRank((prev) => {
        const me = p.ranking.find((entry) => entry.name === myName.current);
        return me ? { rank: me.rank, score: me.score, total: p.ranking.length } : prev;
      });
    };
    const onEnded = ({ reason }: { reason: string | null }) => {
      setEndedReason(reason);
      setPhase("ended");
    };

    socket.on("game:question", onQuestion);
    socket.on("player:result", onResult);
    socket.on("game:podium", onPodium);
    socket.on("game:ended", onEnded);
    return () => {
      socket.off("game:question", onQuestion);
      socket.off("player:result", onResult);
      socket.off("game:podium", onPodium);
      socket.off("game:ended", onEnded);
    };
  }, []);

  const join = () => {
    setError(null);
    setJoining(true);
    socket.emit(
      "player:join",
      { pin: pin.trim(), name: name.trim() },
      (res: { ok: boolean; error?: string; quizTitle?: string; name?: string }) => {
        setJoining(false);
        if (!res.ok) {
          setError(res.error ?? "ההצטרפות נכשלה");
          return;
        }
        setQuizTitle(res.quizTitle ?? "");
        myName.current = res.name ?? name.trim();
        setPhase("lobby");
      },
    );
  };

  const answer = (index: number) => {
    if (selected !== null) return;
    setSelected(index);
    socket.emit("player:answer", { index });
    setPhase("waiting");
  };

  if (phase === "form") {
    return (
      <div className="center-page">
        <h1 className="logo">🐞 BugRhoot</h1>
        <div className="card" style={{ width: "min(92vw, 380px)" }}>
          <div className="field">
            <label htmlFor="pin">קוד משחק</label>
            <input
              id="pin"
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              dir="ltr"
              style={{ textAlign: "center", fontSize: "1.5rem", letterSpacing: "0.2em" }}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div className="field">
            <label htmlFor="name">כינוי</label>
            <input
              id="name"
              maxLength={20}
              placeholder="הכינוי שלכם"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && join()}
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" style={{ width: "100%" }} disabled={joining || pin.length !== 6 || !name.trim()} onClick={join}>
            הצטרפות 🚀
          </button>
        </div>
        <Link className="btn btn-secondary" to="/">← דף הבית</Link>
      </div>
    );
  }

  if (phase === "lobby") {
    return (
      <div className="center-page">
        <h2 className="pop-in">אתם בפנים! 🎉</h2>
        <p className="subtitle">{quizTitle}</p>
        <p>שם השחקן שלכם מופיע על מסך המארח. ממתינים שהמשחק יתחיל…</p>
        <div className="spinner" />
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
        </div>
        <div className="question-text">{question.question}</div>
        {question.code && <pre className="code-block">{question.code}</pre>}
        <AnswerGrid options={question.options} onSelect={answer} selectedIndex={selected} />
      </div>
    );
  }

  if (phase === "waiting") {
    return (
      <div className="center-page">
        <h2>התשובה התקבלה ✓</h2>
        <p className="subtitle">ממתינים לשאר השחקנים…</p>
        <div className="spinner" />
      </div>
    );
  }

  if (phase === "result" && result) {
    return (
      <div className="center-page">
        <div className={`result-banner pop-in ${result.correct ? "good" : "bad"}`}>
          {result.correct ? "נכון! 🎉" : result.answered ? "לא נכון 😅" : "לא ענית בזמן ⏱"}
        </div>
        {result.correct && <p style={{ fontSize: "1.4rem" }}>+{result.points.toLocaleString()} נקודות</p>}
        {result.streak >= 2 && <p>🔥 רצף של {result.streak} תשובות נכונות!</p>}
        {!result.correct && <p style={{ fontSize: "1.05rem", maxWidth: 480 }}>💡 {result.explanation}</p>}
        <p className="subtitle">
          סה"כ: {result.totalScore.toLocaleString()} נק' · מקום {result.rank}
        </p>
        <p style={{ opacity: 0.7 }}>ממתינים לשאלה הבאה…</p>
      </div>
    );
  }

  if (phase === "podium") {
    return (
      <div className="center-page">
        <h1>המשחק נגמר! 🏆</h1>
        {finalRank && (
          <div className="card pop-in" style={{ fontSize: "1.3rem", textAlign: "center" }}>
            {finalRank.rank <= 3 ? ["🥇", "🥈", "🥉"][finalRank.rank - 1] : "🎖"} סיימתם במקום{" "}
            <strong>{finalRank.rank}</strong> מתוך {finalRank.total}
            <div style={{ marginTop: "0.4rem" }}>{finalRank.score.toLocaleString()} נקודות</div>
          </div>
        )}
        <p className="subtitle">הפודיום המלא מוצג על מסך המארח</p>
        <Link className="btn btn-primary" to="/join">משחק נוסף</Link>
      </div>
    );
  }

  return (
    <div className="center-page">
      <h2>{endedReason ?? "המשחק הסתיים"}</h2>
      <Link className="btn btn-primary" to="/join">← הצטרפות למשחק אחר</Link>
    </div>
  );
}
