import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { QuizSummary } from "../types";

export default function AdminDashboard() {
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const refresh = () => {
    api.listQuizzes().then(setQuizzes).catch((e: Error) => setError(e.message));
  };

  useEffect(refresh, []);

  const createQuiz = async () => {
    if (!newTitle.trim()) return;
    try {
      const quiz = await api.createQuiz({ title: newTitle.trim() });
      navigate(`/admin/quiz/${quiz.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const deleteQuiz = async (quiz: QuizSummary) => {
    if (!confirm(`למחוק את החידון "${quiz.title}"?`)) return;
    try {
      await api.deleteQuiz(quiz.id);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="page">
      <div className="admin-header">
        <h1>מסך אדמין</h1>
        <Link className="btn btn-secondary" to="/">
          ← דף הבית
        </Link>
      </div>

      <div className="card" style={{ marginBottom: "1.2rem" }}>
        <div className="field">
          <label htmlFor="new-title">חידון חדש</label>
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <input
              id="new-title"
              placeholder="שם החידון (למשל: מבוא ל-React)"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createQuiz()}
            />
            <button className="btn btn-primary" onClick={createQuiz}>
              יצירה
            </button>
          </div>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="quiz-list">
        {quizzes.map((quiz) => (
          <div className="card quiz-row" key={quiz.id}>
            <div>
              <strong style={{ fontSize: "1.15rem" }}>{quiz.title}</strong>
              <div className="meta">
                {quiz.question_count} שאלות · {quiz.material_count} קבצי חומר ·{" "}
                {quiz.material_chars.toLocaleString()} תווים
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {quiz.material_count > 0 ? (
                <Link className="btn btn-primary" to={`/host/${quiz.id}`}>
                  🎮 אירוח משחק
                </Link>
              ) : (
                <button className="btn btn-primary" disabled title="יש לצרף לפחות קובץ חומר אחד במסך העריכה">
                  🎮 אירוח משחק
                </button>
              )}
              <Link className="btn btn-secondary" style={{ color: "var(--text-dark)", borderColor: "#cfc6e5" }} to={`/admin/quiz/${quiz.id}`}>
                עריכה
              </Link>
              <button className="btn btn-danger" onClick={() => deleteQuiz(quiz)}>
                מחיקה
              </button>
            </div>
          </div>
        ))}
        {quizzes.length === 0 && !error && (
          <p style={{ textAlign: "center", opacity: 0.8 }}>אין עדיין חידונים — צרו אחד למעלה 👆</p>
        )}
      </div>
    </div>
  );
}
