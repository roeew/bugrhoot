import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// בפריסה לענן: DATA_DIR מצביע על volume מתמשך (למשל /data); בפיתוח — server/data
const dataDir = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "bugrhoot.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS quizzes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  focus_description TEXT NOT NULL DEFAULT '',
  question_count INTEGER NOT NULL DEFAULT 10,
  question_time_sec INTEGER NOT NULL DEFAULT 20,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT,
  extracted_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export interface QuizRow {
  id: number;
  title: string;
  focus_description: string;
  question_count: number;
  question_time_sec: number;
  created_at: string;
}

export interface MaterialRow {
  id: number;
  quiz_id: number;
  filename: string;
  mime_type: string | null;
  extracted_text: string;
  created_at: string;
}
