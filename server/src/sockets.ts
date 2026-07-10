import type { Server, Socket } from "socket.io";
import { ADMIN_REQUIRED_ERROR, isAdminKeyValid } from "./auth.js";
import { db, type QuizRow, type MaterialRow } from "./db.js";
import { generateQuestions } from "./generate.js";
import {
  addPlayer,
  closeQuestion,
  createGame,
  findGameByHost,
  findGameByPlayer,
  getGame,
  podium,
  removeGame,
  type Game,
} from "./game.js";

const HOST_DISCONNECT_GRACE_MS = 60_000;
const room = (game: Game) => `game:${game.pin}`;

function lobbyState(game: Game) {
  return {
    pin: game.pin,
    quizTitle: game.quizTitle,
    players: [...game.players.values()].filter((p) => p.connected).map((p) => p.name),
    questionsReady: game.questionsReady,
    questionCount: game.questions.length,
    generationError: game.generationError,
  };
}

function questionPayload(game: Game) {
  const q = game.questions[game.currentIndex];
  return {
    index: game.currentIndex,
    total: game.questions.length,
    question: q.question,
    code: q.code,
    options: q.options, // בלי correctIndex — נחשף רק ב-reveal
    timeMs: game.questionTimeMs,
  };
}

function startQuestion(io: Server, game: Game): void {
  game.currentIndex++;
  game.phase = "question";
  game.answers = new Map();
  game.questionStartedAt = Date.now();
  io.to(room(game)).emit("game:question", questionPayload(game));
  game.questionTimer = setTimeout(() => reveal(io, game), game.questionTimeMs + 500);
}

function reveal(io: Server, game: Game): void {
  if (game.phase !== "question") return;
  const result = closeQuestion(game);
  io.to(game.hostSocketId).emit("game:reveal", {
    correctIndex: result.correctIndex,
    explanation: result.explanation,
    distribution: result.distribution,
    leaderboard: result.leaderboard,
    isLast: game.currentIndex >= game.questions.length - 1,
  });
  for (const [playerId, r] of result.perPlayer) {
    const player = game.players.get(playerId);
    if (player?.connected) {
      io.to(playerId).emit("player:result", {
        correctIndex: result.correctIndex,
        explanation: result.explanation,
        ...r,
      });
    }
  }
}

function endGame(io: Server, game: Game, reason?: string): void {
  io.to(room(game)).emit("game:ended", { reason: reason ?? null });
  removeGame(game.pin);
}

export function registerSockets(io: Server): void {
  io.on("connection", (socket: Socket) => {
    // ---- מארח ----

    socket.on("host:create", (payload: { quizId: number; adminKey?: string }, cb: (res: unknown) => void) => {
      if (!isAdminKeyValid(payload.adminKey)) {
        return cb({ ok: false, error: ADMIN_REQUIRED_ERROR, adminRequired: true });
      }
      const quiz = db.prepare("SELECT * FROM quizzes WHERE id = ?").get(payload.quizId) as QuizRow | undefined;
      if (!quiz) return cb({ ok: false, error: "החידון לא נמצא" });

      const materials = db
        .prepare("SELECT filename, extracted_text FROM materials WHERE quiz_id = ?")
        .all(quiz.id) as Pick<MaterialRow, "filename" | "extracted_text">[];

      const game = createGame({
        quizId: quiz.id,
        quizTitle: quiz.title,
        hostSocketId: socket.id,
        questionTimeSec: quiz.question_time_sec,
      });
      socket.join(room(game));
      cb({ ok: true, ...lobbyState(game) });

      // יצירת השאלות ברקע בזמן שהשחקנים מצטרפים ללובי
      generateQuestions({
        focus: quiz.focus_description,
        materials: materials.map((m) => ({ filename: m.filename, text: m.extracted_text })),
        count: quiz.question_count,
      })
        .then((questions) => {
          if (getGame(game.pin) !== game) return; // המשחק נסגר בינתיים
          game.questions = questions;
          game.questionsReady = true;
          io.to(room(game)).emit("game:lobby", lobbyState(game));
        })
        .catch((err: unknown) => {
          if (getGame(game.pin) !== game) return;
          let message = err instanceof Error ? err.message : "יצירת השאלות נכשלה";
          if (/authentication|api.?key|401/i.test(message)) {
            message = "חסר מפתח API של Anthropic — הגדירו ANTHROPIC_API_KEY בקובץ ‎.env והפעילו את השרת מחדש";
          }
          game.generationError = message;
          io.to(room(game)).emit("game:lobby", lobbyState(game));
        });
    });

    socket.on("host:start", () => {
      const game = findGameByHost(socket.id);
      if (!game || game.phase !== "lobby" || !game.questionsReady) return;
      if (game.players.size === 0) return;
      startQuestion(io, game);
    });

    socket.on("host:next", () => {
      const game = findGameByHost(socket.id);
      if (!game || game.phase !== "reveal") return;
      if (game.currentIndex >= game.questions.length - 1) {
        game.phase = "podium";
        io.to(room(game)).emit("game:podium", { ranking: podium(game) });
      } else {
        startQuestion(io, game);
      }
    });

    socket.on("host:end", () => {
      const game = findGameByHost(socket.id);
      if (game) endGame(io, game);
    });

    // ---- שחקן ----

    socket.on("player:join", (payload: { pin: string; name: string }, cb: (res: unknown) => void) => {
      const game = getGame(String(payload.pin ?? "").trim());
      if (!game) return cb({ ok: false, error: "לא נמצא משחק עם הקוד הזה" });
      const result = addPlayer(game, socket.id, String(payload.name ?? ""));
      if (!result.ok) return cb(result);
      socket.join(room(game));
      cb({ ok: true, pin: game.pin, quizTitle: game.quizTitle, name: String(payload.name).trim() });
      io.to(room(game)).emit("game:lobby", lobbyState(game));
    });

    socket.on("player:answer", (payload: { index: number }) => {
      const game = findGameByPlayer(socket.id);
      if (!game || game.phase !== "question") return;
      if (game.answers.has(socket.id)) return;
      const index = Number(payload.index);
      if (!Number.isInteger(index) || index < 0 || index > 3) return;

      const timeMs = Math.min(Date.now() - game.questionStartedAt, game.questionTimeMs);
      game.answers.set(socket.id, { index, timeMs });
      socket.emit("player:answer_received");

      const connectedPlayers = [...game.players.values()].filter((p) => p.connected);
      io.to(game.hostSocketId).emit("game:answer_count", {
        answered: game.answers.size,
        total: connectedPlayers.length,
      });
      if (connectedPlayers.every((p) => game.answers.has(p.id))) {
        reveal(io, game);
      }
    });

    // ---- ניתוקים ----

    socket.on("disconnect", () => {
      const hostedGame = findGameByHost(socket.id);
      if (hostedGame) {
        // המארח התנתק — חלון חסד של דקה ואז המשחק נסגר
        hostedGame.hostDisconnectTimer = setTimeout(() => {
          endGame(io, hostedGame, "המארח עזב את המשחק");
        }, HOST_DISCONNECT_GRACE_MS);
        return;
      }
      const game = findGameByPlayer(socket.id);
      if (game) {
        const player = game.players.get(socket.id);
        if (player) player.connected = false;
        io.to(room(game)).emit("game:lobby", lobbyState(game));
        io.to(game.hostSocketId).emit("game:player_left", { name: player?.name });
      }
    });
  });
}
