import type { QuizDetails, QuizSummary } from "./types";

const ADMIN_KEY_STORAGE = "bugrhoot_admin_key";
export const getAdminKey = () => localStorage.getItem(ADMIN_KEY_STORAGE) ?? "";
export const setAdminKey = (key: string) => localStorage.setItem(ADMIN_KEY_STORAGE, key);

/** מבקש סיסמת אדמין מהמשתמש ושומר אותה; מחזיר false אם ביטל */
export function promptForAdminKey(): boolean {
  const password = window.prompt("השרת מוגן — נא להזין סיסמת אדמין:");
  if (password === null) return false;
  setAdminKey(password);
  return true;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const doFetch = () =>
    fetch(url, { ...init, headers: { ...(init?.headers ?? {}), "x-admin-key": getAdminKey() } });
  let res = await doFetch();
  if (res.status === 401 && promptForAdminKey()) {
    res = await doFetch();
  }
  if (!res.ok) {
    let message = `שגיאה (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* גוף לא-JSON */
    }
    throw new Error(message);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  listQuizzes: () => request<QuizSummary[]>("/api/quizzes"),
  createQuiz: (data: { title: string }) =>
    request<QuizSummary>("/api/quizzes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  getQuiz: (id: number | string) => request<QuizDetails>(`/api/quizzes/${id}`),
  updateQuiz: (id: number, data: Partial<Pick<QuizSummary, "title" | "focus_description" | "question_count" | "question_time_sec">>) =>
    request<QuizSummary>(`/api/quizzes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteQuiz: (id: number) => request<void>(`/api/quizzes/${id}`, { method: "DELETE" }),
  uploadMaterials: (id: number, files: FileList) => {
    const form = new FormData();
    for (const file of Array.from(files)) form.append("files", file);
    return request<{ added: { filename: string; chars: number }[]; errors: string[] }>(
      `/api/quizzes/${id}/materials`,
      { method: "POST", body: form },
    );
  },
  deleteMaterial: (quizId: number, materialId: number) =>
    request<void>(`/api/quizzes/${quizId}/materials/${materialId}`, { method: "DELETE" }),
  serverInfo: () => request<{ lanIp: string | null }>("/api/server-info"),
};
