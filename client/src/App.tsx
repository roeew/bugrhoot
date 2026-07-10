import { Link, Route, Routes } from "react-router-dom";
import AdminDashboard from "./pages/AdminDashboard";
import QuizEditor from "./pages/QuizEditor";
import HostGame from "./pages/HostGame";
import Join from "./pages/Join";

function Home() {
  return (
    <div className="center-page">
      <h1 className="logo">🐞 BugRhoot</h1>
      <p className="subtitle">משחק טריוויה חי — השאלות נוצרות מהחומרים שלכם</p>
      <div className="home-actions">
        <Link className="btn btn-primary btn-big" to="/join">
          הצטרפות למשחק
        </Link>
        <Link className="btn btn-secondary btn-big" to="/admin">
          מסך אדמין
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/admin" element={<AdminDashboard />} />
      <Route path="/admin/quiz/:id" element={<QuizEditor />} />
      <Route path="/host/:quizId" element={<HostGame />} />
      <Route path="/join" element={<Join />} />
    </Routes>
  );
}
