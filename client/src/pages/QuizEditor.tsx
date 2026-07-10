import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { QuizDetails } from "../types";

export default function QuizEditor() {
  const { id } = useParams();
  const [quiz, setQuiz] = useState<QuizDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => {
    api.getQuiz(id!).then(setQuiz).catch((e: Error) => setError(e.message));
  };

  useEffect(refresh, [id]);

  if (error) {
    return (
      <div className="page">
        <p className="error-text">{error}</p>
        <Link className="btn btn-secondary" to="/admin">← חזרה</Link>
      </div>
    );
  }
  if (!quiz) return <div className="center-page"><div className="spinner" /></div>;

  const save = async () => {
    try {
      await api.updateQuiz(quiz.id, {
        title: quiz.title,
        focus_description: quiz.focus_description,
        question_count: quiz.question_count,
        question_time_sec: quiz.question_time_sec,
      });
      setSavedMsg("נשמר ✓");
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadErrors([]);
    try {
      const result = await api.uploadMaterials(quiz.id, files);
      setUploadErrors(result.errors);
      refresh();
    } catch (e) {
      setUploadErrors([(e as Error).message]);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const removeMaterial = async (materialId: number) => {
    await api.deleteMaterial(quiz.id, materialId);
    refresh();
  };

  return (
    <div className="page">
      <div className="admin-header">
        <h1>עריכת חידון</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Link className="btn btn-primary" to={`/host/${quiz.id}`}>🎮 אירוח משחק</Link>
          <Link className="btn btn-secondary" to="/admin">← חזרה</Link>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1.2rem" }}>
        <div className="field">
          <label>שם החידון</label>
          <input value={quiz.title} onChange={(e) => setQuiz({ ...quiz, title: e.target.value })} />
        </div>

        <div className="field">
          <label>1. תיאור מיקוד השאלות (אופציונלי)</label>
          <textarea
            rows={4}
            placeholder="על מה יתבססו השאלות? באילו אופנים, עומק ומיקודים? — אם יישאר ריק, ה-AI יבחר את המיקוד והעומק בעצמו"
            value={quiz.focus_description}
            onChange={(e) => setQuiz({ ...quiz, focus_description: e.target.value })}
          />
          <div className="hint">ריק = חופש מלא ל-AI להחליט על עומק ומיקוד השאלות סביב החומר.</div>
        </div>

        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label>3. מספר שאלות (1–30)</label>
            <input
              type="number"
              min={1}
              max={30}
              value={quiz.question_count}
              onChange={(e) => setQuiz({ ...quiz, question_count: Number(e.target.value) })}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label>זמן לשאלה (שניות)</label>
            <input
              type="number"
              min={5}
              max={120}
              value={quiz.question_time_sec}
              onChange={(e) => setQuiz({ ...quiz, question_time_sec: Number(e.target.value) })}
            />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
          <button className="btn btn-primary" onClick={save}>שמירה</button>
          {savedMsg && <span className="success-text">{savedMsg}</span>}
        </div>
      </div>

      <div className="card">
        <div className="field">
          <label>2. חומרי הבסיס לשאלות</label>
          <div className="hint" style={{ marginBottom: "0.6rem" }}>
            קבצי טקסט, PDF, קוד או markdown — השאלות ייווצרו אך ורק מהתוכן שלהם.
            סה"כ כרגע: {quiz.material_chars.toLocaleString()} תווים.
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".pdf,.txt,.md,.py,.js,.ts,.tsx,.jsx,.java,.c,.cpp,.h,.cs,.go,.rb,.rs,.php,.html,.css,.json,.yaml,.yml,.xml,.sql,.sh,text/*,application/pdf"
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
        {quiz.materials.length === 0 && <p style={{ color: "#6b6180" }}>עוד לא הועלו חומרים.</p>}
      </div>
    </div>
  );
}
