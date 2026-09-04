import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { MATERIAL_ACCEPT } from "../constants";
import type { QuizDetails } from "../types";

/** השדות שנשמרים בכפתור "שמירה" — הקבצים נשמרים מיידית בהעלאה ולא דרכו */
type Draft = Pick<QuizDetails, "title" | "focus_description" | "question_count" | "question_time_sec">;

const draftOf = (quiz: QuizDetails): Draft => ({
  title: quiz.title,
  focus_description: quiz.focus_description,
  question_count: quiz.question_count,
  question_time_sec: quiz.question_time_sec,
});

const sameDraft = (a: Draft, b: Draft) =>
  a.title.trim() === b.title.trim() &&
  a.focus_description === b.focus_description &&
  a.question_count === b.question_count &&
  a.question_time_sec === b.question_time_sec;

export default function QuizEditor() {
  const { id } = useParams();
  const [quiz, setQuiz] = useState<QuizDetails | null>(null); // מצב החידון כפי שהוא בשרת
  const [draft, setDraft] = useState<Draft | null>(null); // מצב הטופס שעדיין לא נשמר
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  /** טוען מהשרת; syncDraft מסנכרן גם את הטופס (טעינה ראשונה ואחרי שמירה) */
  const load = useCallback(
    async (syncDraft: boolean) => {
      const fresh = await api.getQuiz(id!);
      setQuiz(fresh);
      if (syncDraft) setDraft(draftOf(fresh));
    },
    [id],
  );

  useEffect(() => {
    load(true).catch((e: Error) => setError(e.message));
  }, [load]);

  if (error && !quiz) {
    return (
      <div className="page">
        <p className="error-text">{error}</p>
        <Link className="btn btn-secondary" to="/admin">← חזרה</Link>
      </div>
    );
  }
  if (!quiz || !draft) return <div className="center-page"><div className="spinner" /></div>;

  // --- תנאי המוכנות: מה חייב להתקיים כדי שאפשר יהיה לשמור ולארח ---
  const titleOk = draft.title.trim().length > 0;
  const countsOk =
    Number.isFinite(draft.question_count) &&
    draft.question_count >= 1 &&
    draft.question_count <= 30 &&
    Number.isFinite(draft.question_time_sec) &&
    draft.question_time_sec >= 5 &&
    draft.question_time_sec <= 120;
  const materialsOk = quiz.materials.length > 0;
  const dirty = !sameDraft(draft, draftOf(quiz));

  const canSave = dirty && titleOk && countsOk && !saving;
  const canHost = !dirty && titleOk && materialsOk && !saving && !uploading;

  const hostBlockedReason = !titleOk
    ? "יש להזין שם לחידון"
    : !materialsOk
      ? "יש לצרף לפחות קובץ חומר אחד"
      : dirty
        ? "יש לשמור את השינויים לפני אירוח משחק"
        : uploading
          ? "ממתין לסיום העלאת הקבצים"
          : "";

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateQuiz(quiz.id, {
        title: draft.title.trim(),
        focus_description: draft.focus_description,
        question_count: draft.question_count,
        question_time_sec: draft.question_time_sec,
      });
      await load(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadErrors([]);
    try {
      const result = await api.uploadMaterials(quiz.id, files);
      setUploadErrors(result.errors);
      await load(false); // לא לדרוס עריכות שטרם נשמרו
    } catch (e) {
      setUploadErrors([(e as Error).message]);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const removeMaterial = async (materialId: number) => {
    try {
      await api.deleteMaterial(quiz.id, materialId);
      await load(false);
    } catch (e) {
      setUploadErrors([(e as Error).message]);
    }
  };

  const saveLabel = saving ? "שומר…" : dirty ? "שמירת שינויים" : "נשמר ✓";

  return (
    <div className="page">
      <div className="admin-header">
        <h1>עריכת חידון</h1>
        <div className="header-actions">
          {canHost ? (
            <Link className="btn btn-primary" to={`/host/${quiz.id}`}>🎮 אירוח משחק</Link>
          ) : (
            <button className="btn btn-primary" disabled title={hostBlockedReason}>🎮 אירוח משחק</button>
          )}
          <Link className="btn btn-secondary" to="/admin">← חזרה</Link>
        </div>
      </div>

      <div className="readiness-bar">
        <span className="readiness-title">מוכנות לאירוח:</span>
        <ul className="readiness">
          <li className={titleOk ? "done" : "todo"}>שם לחידון</li>
          <li className={materialsOk ? "done" : "todo"}>לפחות קובץ חומר אחד</li>
          <li className={!dirty ? "done" : "todo"}>כל השינויים נשמרו</li>
        </ul>
      </div>

      <div className="card" style={{ marginBottom: "1.2rem" }}>
        <div className="field">
          <label htmlFor="quiz-title">
            שם החידון<span className="badge badge-required">חובה</span>
          </label>
          <input
            id="quiz-title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          {!titleOk && <div className="error-text" style={{ marginTop: "0.35rem" }}>שם החידון אינו יכול להישאר ריק.</div>}
        </div>

        <div className="field">
          <label htmlFor="quiz-focus">
            תיאור מיקוד השאלות<span className="badge badge-optional">אופציונלי</span>
          </label>
          <textarea
            id="quiz-focus"
            rows={4}
            placeholder="על מה יתבססו השאלות? באילו אופנים, עומק ומיקודים? — אם יישאר ריק, ה-AI יבחר את המיקוד והעומק בעצמו"
            value={draft.focus_description}
            onChange={(e) => setDraft({ ...draft, focus_description: e.target.value })}
          />
          <div className="hint">ריק = חופש מלא ל-AI להחליט על עומק ומיקוד השאלות סביב החומר.</div>
        </div>

        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="quiz-count">מספר שאלות (1–30)</label>
            <input
              id="quiz-count"
              type="number"
              min={1}
              max={30}
              value={draft.question_count}
              onChange={(e) => setDraft({ ...draft, question_count: Number(e.target.value) })}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="quiz-time">זמן לשאלה (5–120 שניות)</label>
            <input
              id="quiz-time"
              type="number"
              min={5}
              max={120}
              value={draft.question_time_sec}
              onChange={(e) => setDraft({ ...draft, question_time_sec: Number(e.target.value) })}
            />
          </div>
        </div>
        {!countsOk && <p className="error-text">מספר השאלות חייב להיות 1–30 והזמן לשאלה 5–120 שניות.</p>}

        <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={save} disabled={!canSave}>{saveLabel}</button>
          {!dirty && !saving && <span className="success-text">אין שינויים שממתינים לשמירה</span>}
          {dirty && !saving && <span className="hint">יש שינויים שלא נשמרו</span>}
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>

      <div className="card">
        <div className="field">
          <label htmlFor="quiz-materials">
            חומרי הבסיס לשאלות<span className="badge badge-required">חובה</span>
          </label>
          <div className="hint" style={{ marginBottom: "0.6rem" }}>
            PDF, Word ‏(doc/docx), PowerPoint ‏(ppt/pptx), טקסט, קוד או markdown — השאלות ייווצרו אך ורק מהתוכן שלהם.
            סה"כ כרגע: {quiz.material_chars.toLocaleString()} תווים.
          </div>
          <input
            id="quiz-materials"
            ref={fileInput}
            type="file"
            multiple
            accept={MATERIAL_ACCEPT}
            onChange={(e) => upload(e.target.files)}
            disabled={uploading}
          />
          {uploading && <p>מעלה ומחלץ טקסט…</p>}
          {uploadErrors.map((err, i) => (
            <p key={i} className="error-text">{err}</p>
          ))}
        </div>

        {quiz.materials.map((material) => (
          <div className="material-row" key={material.id}>
            <span dir="ltr" style={{ fontFamily: "monospace" }}>{material.filename}</span>
            <span style={{ display: "flex", gap: "0.8rem", alignItems: "center" }}>
              <span className="meta" style={{ color: "#6b6180", fontSize: "0.85rem" }}>
                {material.chars.toLocaleString()} תווים
              </span>
              <button className="btn btn-danger" style={{ padding: "0.3rem 0.8rem" }} onClick={() => removeMaterial(material.id)}>
                הסרה
              </button>
            </span>
          </div>
        ))}
        {!materialsOk && (
          <p className="error-text">חובה לצרף לפחות קובץ חומר אחד — בלעדיו לא ניתן לארח משחק.</p>
        )}
      </div>
    </div>
  );
}
