import { Router } from "express";
import multer from "multer";
import { ADMIN_REQUIRED_ERROR, isAdminKeyValid } from "../auth.js";
import { db, type MaterialRow, type QuizRow } from "../db.js";
import { extractText } from "../extract.js";
import { MAX_MATERIAL_CHARS } from "../generate.js";

export const quizzesRouter = Router();

quizzesRouter.use((req, res, next) => {
  if (isAdminKeyValid(req.get("x-admin-key"))) return next();
  res.status(401).json({ error: ADMIN_REQUIRED_ERROR });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
});

function quizSummary(quiz: QuizRow) {
  const stats = db
    .prepare("SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(extracted_text)), 0) AS chars FROM materials WHERE quiz_id = ?")
    .get(quiz.id) as { count: number; chars: number };
  return { ...quiz, material_count: stats.count, material_chars: stats.chars };
}

quizzesRouter.get("/", (_req, res) => {
  const quizzes = db.prepare("SELECT * FROM quizzes ORDER BY created_at DESC").all() as QuizRow[];
  res.json(quizzes.map(quizSummary));
});

quizzesRouter.post("/", (req, res) => {
  const { title, focus_description = "", question_count = 10, question_time_sec = 20 } = req.body ?? {};
  if (typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "לחידון חייב להיות שם" });
  }
  const count = Math.min(Math.max(Number(question_count) || 10, 1), 30);
  const timeSec = Math.min(Math.max(Number(question_time_sec) || 20, 5), 120);
  const info = db
    .prepare("INSERT INTO quizzes (title, focus_description, question_count, question_time_sec) VALUES (?, ?, ?, ?)")
    .run(title.trim(), String(focus_description ?? ""), count, timeSec);
  const quiz = db.prepare("SELECT * FROM quizzes WHERE id = ?").get(info.lastInsertRowid) as QuizRow;
  res.status(201).json(quizSummary(quiz));
});

quizzesRouter.get("/:id", (req, res) => {
  const quiz = db.prepare("SELECT * FROM quizzes WHERE id = ?").get(req.params.id) as QuizRow | undefined;
  if (!quiz) return res.status(404).json({ error: "החידון לא נמצא" });
  const materials = db
    .prepare("SELECT id, filename, mime_type, LENGTH(extracted_text) AS chars, created_at FROM materials WHERE quiz_id = ? ORDER BY id")
    .all(quiz.id);
  res.json({ ...quizSummary(quiz), materials });
});

quizzesRouter.put("/:id", (req, res) => {
  const quiz = db.prepare("SELECT * FROM quizzes WHERE id = ?").get(req.params.id) as QuizRow | undefined;
  if (!quiz) return res.status(404).json({ error: "החידון לא נמצא" });
  const { title, focus_description, question_count, question_time_sec } = req.body ?? {};
  const newTitle = typeof title === "string" && title.trim() ? title.trim() : quiz.title;
  const newFocus = typeof focus_description === "string" ? focus_description : quiz.focus_description;
  const newCount = question_count != null ? Math.min(Math.max(Number(question_count) || quiz.question_count, 1), 30) : quiz.question_count;
  const newTime = question_time_sec != null ? Math.min(Math.max(Number(question_time_sec) || quiz.question_time_sec, 5), 120) : quiz.question_time_sec;
  db.prepare("UPDATE quizzes SET title = ?, focus_description = ?, question_count = ?, question_time_sec = ? WHERE id = ?")
    .run(newTitle, newFocus, newCount, newTime, quiz.id);
  const updated = db.prepare("SELECT * FROM quizzes WHERE id = ?").get(quiz.id) as QuizRow;
  res.json(quizSummary(updated));
});

quizzesRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM quizzes WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

quizzesRouter.post("/:id/materials", upload.array("files"), async (req, res) => {
  const quiz = db.prepare("SELECT * FROM quizzes WHERE id = ?").get(req.params.id) as QuizRow | undefined;
  if (!quiz) return res.status(404).json({ error: "החידון לא נמצא" });
  const files = (req.files ?? []) as Express.Multer.File[];
  if (files.length === 0) return res.status(400).json({ error: "לא נשלחו קבצים" });

  const existing = db
    .prepare("SELECT COALESCE(SUM(LENGTH(extracted_text)), 0) AS chars FROM materials WHERE quiz_id = ?")
    .get(quiz.id) as { chars: number };
  let totalChars = existing.chars;

  const insert = db.prepare("INSERT INTO materials (quiz_id, filename, mime_type, extracted_text) VALUES (?, ?, ?, ?)");
  const added: { filename: string; chars: number }[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const filename = Buffer.from(file.originalname, "latin1").toString("utf-8");
    try {
      const text = await extractText(filename, file.mimetype, file.buffer);
      if (!text) {
        errors.push(`"${filename}": לא חולץ טקסט מהקובץ`);
        continue;
      }
      if (totalChars + text.length > MAX_MATERIAL_CHARS) {
        errors.push(`"${filename}": חריגה ממכסת החומר הכוללת (${MAX_MATERIAL_CHARS.toLocaleString()} תווים)`);
        continue;
      }
      insert.run(quiz.id, filename, file.mimetype, text);
      totalChars += text.length;
      added.push({ filename, chars: text.length });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : `"${filename}": שגיאה בעיבוד הקובץ`);
    }
  }

  res.status(errors.length && !added.length ? 400 : 201).json({ added, errors });
});

quizzesRouter.delete("/:id/materials/:materialId", (req, res) => {
  const material = db
    .prepare("SELECT * FROM materials WHERE id = ? AND quiz_id = ?")
    .get(req.params.materialId, req.params.id) as MaterialRow | undefined;
  if (!material) return res.status(404).json({ error: "הקובץ לא נמצא" });
  db.prepare("DELETE FROM materials WHERE id = ?").run(material.id);
  res.status(204).end();
});
