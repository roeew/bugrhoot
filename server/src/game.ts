import type { GeneratedQuestion } from "./generate.js";

export type GamePhase = "lobby" | "question" | "reveal" | "podium" | "ended";

export interface Player {
  id: string; // socket id
  name: string;
  score: number;
  streak: number;
  connected: boolean;
}

export interface PlayerAnswer {
  index: number;
  timeMs: number;
}

export interface Game {
  pin: string;
  quizId: number;
  quizTitle: string;
  hostSocketId: string;
  phase: GamePhase;
  players: Map<string, Player>;
  questions: GeneratedQuestion[];
  questionsReady: boolean;
  generationError: string | null;
  currentIndex: number;
  questionTimeMs: number;
  questionStartedAt: number;
  answers: Map<string, PlayerAnswer>;
  questionTimer: ReturnType<typeof setTimeout> | null;
  hostDisconnectTimer: ReturnType<typeof setTimeout> | null;
}

const games = new Map<string, Game>();

function randomPin(): string {
  let pin: string;
  do {
    pin = String(Math.floor(100000 + Math.random() * 900000));
  } while (games.has(pin));
  return pin;
}

export function createGame(opts: {
  quizId: number;
  quizTitle: string;
  hostSocketId: string;
  questionTimeSec: number;
}): Game {
  const game: Game = {
    pin: randomPin(),
    quizId: opts.quizId,
    quizTitle: opts.quizTitle,
    hostSocketId: opts.hostSocketId,
    phase: "lobby",
    players: new Map(),
    questions: [],
    questionsReady: false,
    generationError: null,
    currentIndex: -1,
    questionTimeMs: opts.questionTimeSec * 1000,
    questionStartedAt: 0,
    answers: new Map(),
    questionTimer: null,
    hostDisconnectTimer: null,
  };
  games.set(game.pin, game);
  return game;
}

export function getGame(pin: string): Game | undefined {
  return games.get(pin);
}

export function findGameByHost(socketId: string): Game | undefined {
  for (const game of games.values()) {
    if (game.hostSocketId === socketId && game.phase !== "ended") return game;
  }
  return undefined;
}

export function findGameByPlayer(socketId: string): Game | undefined {
  for (const game of games.values()) {
    if (game.players.has(socketId) && game.phase !== "ended") return game;
  }
  return undefined;
}

export function removeGame(pin: string): void {
  const game = games.get(pin);
  if (game) {
    if (game.questionTimer) clearTimeout(game.questionTimer);
    if (game.hostDisconnectTimer) clearTimeout(game.hostDisconnectTimer);
    game.phase = "ended";
    games.delete(pin);
  }
}

export function addPlayer(game: Game, socketId: string, name: string): { ok: true } | { ok: false; error: string } {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 20) return { ok: false, error: "כינוי חייב להיות באורך 1–20 תווים" };
  if (game.phase !== "lobby") return { ok: false, error: "המשחק כבר התחיל" };
  for (const p of game.players.values()) {
    if (p.name === trimmed && p.connected) return { ok: false, error: "הכינוי כבר תפוס במשחק הזה" };
  }
  game.players.set(socketId, { id: socketId, name: trimmed, score: 0, streak: 0, connected: true });
  return { ok: true };
}

/** ניקוד בסגנון Kahoot: תשובה מיידית ≈ 1000, ברגע האחרון ≈ 500 */
export function computePoints(timeMs: number, questionTimeMs: number): number {
  const ratio = Math.min(Math.max(timeMs / questionTimeMs, 0), 1);
  return Math.round(1000 * (1 - ratio / 2));
}

/** בונוס רצף: מהתשובה הנכונה השנייה ברצף +100 לכל שלב, עד +500 */
export function streakBonus(streak: number): number {
  return Math.min(Math.max(streak - 1, 0), 5) * 100;
}

export interface RevealResult {
  correctIndex: number;
  explanation: string;
  distribution: [number, number, number, number];
  perPlayer: Map<string, { correct: boolean; answered: boolean; points: number; totalScore: number; streak: number; rank: number }>;
  leaderboard: { name: string; score: number }[];
}

/** סוגר את השאלה הנוכחית: מחשב ניקוד, רצפים, התפלגות ודירוג */
export function closeQuestion(game: Game): RevealResult {
  const question = game.questions[game.currentIndex];
  const distribution: [number, number, number, number] = [0, 0, 0, 0];
  const gained = new Map<string, { correct: boolean; answered: boolean; points: number }>();

  for (const player of game.players.values()) {
    const answer = game.answers.get(player.id);
    if (!answer) {
      player.streak = 0;
      gained.set(player.id, { correct: false, answered: false, points: 0 });
      continue;
    }
    distribution[answer.index]++;
    const correct = answer.index === question.correctIndex;
    if (correct) {
      player.streak++;
      const points = computePoints(answer.timeMs, game.questionTimeMs) + streakBonus(player.streak);
      player.score += points;
      gained.set(player.id, { correct: true, answered: true, points });
    } else {
      player.streak = 0;
      gained.set(player.id, { correct: false, answered: true, points: 0 });
    }
  }

  const ranked = [...game.players.values()].sort((a, b) => b.score - a.score);
  const perPlayer: RevealResult["perPlayer"] = new Map();
  ranked.forEach((player, i) => {
    const g = gained.get(player.id)!;
    perPlayer.set(player.id, { ...g, totalScore: player.score, streak: player.streak, rank: i + 1 });
  });

  game.phase = "reveal";
  if (game.questionTimer) {
    clearTimeout(game.questionTimer);
    game.questionTimer = null;
  }

  return {
    correctIndex: question.correctIndex,
    explanation: question.explanation,
    distribution,
    perPlayer,
    leaderboard: ranked.slice(0, 5).map((p) => ({ name: p.name, score: p.score })),
  };
}

export function podium(game: Game): { name: string; score: number; rank: number }[] {
  return [...game.players.values()]
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ name: p.name, score: p.score, rank: i + 1 }));
}
