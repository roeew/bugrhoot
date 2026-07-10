export interface QuizSummary {
  id: number;
  title: string;
  focus_description: string;
  question_count: number;
  question_time_sec: number;
  created_at: string;
  material_count: number;
  material_chars: number;
}

export interface MaterialSummary {
  id: number;
  filename: string;
  mime_type: string | null;
  chars: number;
  created_at: string;
}

export interface QuizDetails extends QuizSummary {
  materials: MaterialSummary[];
}

export interface LobbyState {
  pin: string;
  quizTitle: string;
  players: string[];
  questionsReady: boolean;
  questionCount: number;
  generationError: string | null;
}

export interface QuestionPayload {
  index: number;
  total: number;
  question: string;
  code: string | null;
  options: string[];
  timeMs: number;
}

export interface RevealPayload {
  correctIndex: number;
  explanation: string;
  distribution: [number, number, number, number];
  leaderboard: { name: string; score: number }[];
  isLast: boolean;
}

export interface PlayerResultPayload {
  correctIndex: number;
  explanation: string;
  correct: boolean;
  answered: boolean;
  points: number;
  totalScore: number;
  streak: number;
  rank: number;
}

export interface PodiumPayload {
  ranking: { name: string; score: number; rank: number }[];
}
