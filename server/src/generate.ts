import Anthropic from "@anthropic-ai/sdk";

// נוצר עצלנית בקריאה הראשונה — כדי שה-SDK יקרא את ANTHROPIC_API_KEY רק אחרי ש-dotenv טען את ‎.env
// (ב-ESM ה-imports מוערכים לפני גוף index.ts, כך שיצירה בזמן import מפספסת את המפתח)
let client: Anthropic | null = null;
function getClient(): Anthropic {
  return (client ??= new Anthropic());
}

export interface GeneratedQuestion {
  question: string;
  code: string | null;
  options: string[];
  correctIndex: number;
  explanation: string;
}

// גבול נדיב לחומרי הבסיס — מעבר לזה מחזירים שגיאה ברורה לאדמין במקום חיתוך שקט
export const MAX_MATERIAL_CHARS = 500_000;

const questionsSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          code: { anyOf: [{ type: "string" }, { type: "null" }] },
          options: { type: "array", items: { type: "string" } },
          correctIndex: { type: "integer", enum: [0, 1, 2, 3] },
          explanation: { type: "string" },
        },
        required: ["question", "code", "options", "correctIndex", "explanation"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `אתה מחולל שאלות טריוויה למשחק רב-משתתפים בסגנון Kahoot.

חוקים מחייבים:
- כל שאלה מבוססת אך ורק על חומרי הבסיס המצורפים. אסור להמציא עובדות שאינן מופיעות בחומר, ואסור לשאול על ידע כללי שאינו נדרש להבנת החומר.
- לכל שאלה בדיוק 4 אפשרויות תשובה, שרק אחת מהן נכונה. המסיחים צריכים להיות סבירים אך שגויים באופן חד-משמעי לפי החומר.
- אם צורף "תיאור מיקוד" — פעל לפיו במדויק (נושאים, עומק, סגנון). אם לא צורף — בחר בעצמך את המיקוד והעומק המתאימים ביותר לחומר, עם פיזור רחב על פני כלל החומר.
- אם החומר כולל קוד — שלב גם שאלות ניתוח והבנת קוד (מה הפלט, מה עושה הפונקציה, איפה הבאג וכו'). קטע קוד רלוונטי לשאלה יופיע בשדה code (עד ~15 שורות); בשאלות ללא קוד השדה יהיה null. אין לשכתב קוד מהחומר — צטט אותו כפי שהוא.
- השאלות, האפשרויות וההסברים ייכתבו בעברית ברורה וקצרה (מונחים טכניים ושמות מזהים נשארים באנגלית). שאלה עד ~120 תווים, כל אפשרות עד ~75 תווים — הן מוצגות על כפתורים.
- explanation: הסבר של משפט אחד-שניים מדוע התשובה נכונה, שיוצג לאחר חשיפת התשובה.
- דרג את השאלות מקל לקשה לאורך המשחק.`;

function buildUserPrompt(opts: { focus: string; materials: { filename: string; text: string }[]; count: number }): string {
  const materialsBlock = opts.materials
    .map((m) => `<material filename="${m.filename}">\n${m.text}\n</material>`)
    .join("\n\n");
  const focusBlock = opts.focus.trim()
    ? `<focus_description>\n${opts.focus.trim()}\n</focus_description>`
    : `<focus_description>לא סופק תיאור מיקוד — בחר את המיקוד והעומק בעצמך.</focus_description>`;
  return `${focusBlock}\n\n<materials>\n${materialsBlock}\n</materials>\n\nצור בדיוק ${opts.count} שאלות על בסיס החומרים שלמעלה.`;
}

/** ערבוב Fisher-Yates של אפשרויות התשובה — מודלים נוטים להטות את מיקום התשובה הנכונה */
export function shuffleQuestionOptions(q: GeneratedQuestion): GeneratedQuestion {
  const order = [0, 1, 2, 3];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    ...q,
    options: order.map((i) => q.options[i]),
    correctIndex: order.indexOf(q.correctIndex),
  };
}

function validateQuestions(raw: unknown, count: number): GeneratedQuestion[] {
  const parsed = raw as { questions?: unknown };
  if (!parsed || !Array.isArray(parsed.questions)) throw new Error("מבנה תשובה לא תקין");
  const questions = parsed.questions as GeneratedQuestion[];
  for (const q of questions) {
    if (typeof q.question !== "string" || !q.question.trim()) throw new Error("שאלה ריקה");
    if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some((o) => typeof o !== "string" || !o.trim())) {
      throw new Error("שאלה ללא 4 אפשרויות תקינות");
    }
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3) {
      throw new Error("correctIndex לא תקין");
    }
  }
  if (questions.length < count) throw new Error(`נוצרו רק ${questions.length} שאלות מתוך ${count}`);
  return questions.slice(0, count);
}

/** מצב פיתוח: MOCK_QUESTIONS=1 מחזיר שאלות דמה בלי לקרוא ל-API */
function mockQuestions(count: number): GeneratedQuestion[] {
  return Array.from({ length: count }, (_, i) => ({
    question: `שאלת דמה מספר ${i + 1}: איזו תשובה נכונה?`,
    code: i % 2 === 1 ? `function demo() {\n  return ${i + 1};\n}` : null,
    options: ["תשובה א", "תשובה ב", "תשובה ג", "תשובה ד"],
    correctIndex: i % 4,
    explanation: `זו תשובת הדמה של שאלה ${i + 1}.`,
  }));
}

export async function generateQuestions(opts: {
  focus: string;
  materials: { filename: string; text: string }[];
  count: number;
}): Promise<GeneratedQuestion[]> {
  if (process.env.MOCK_QUESTIONS === "1") {
    await new Promise((r) => setTimeout(r, 1500)); // מדמה זמן יצירה
    return mockQuestions(opts.count).map(shuffleQuestionOptions);
  }
  if (opts.materials.length === 0) {
    throw new Error("לא הועלו חומרי בסיס לחידון — יש להעלות לפחות קובץ אחד");
  }
  const totalChars = opts.materials.reduce((sum, m) => sum + m.text.length, 0);
  if (totalChars > MAX_MATERIAL_CHARS) {
    throw new Error(`חומרי הבסיס גדולים מדי (${totalChars.toLocaleString()} תווים, המקסימום ${MAX_MATERIAL_CHARS.toLocaleString()}) — יש להסיר או לקצר קבצים`);
  }

  const userPrompt = buildUserPrompt(opts);
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const stream = getClient().messages.stream({
        model: "claude-opus-4-8",
        max_tokens: 64000,
        thinking: { type: "adaptive" },
        system: SYSTEM_PROMPT,
        output_config: { format: { type: "json_schema", schema: questionsSchema } },
        messages: [{ role: "user", content: userPrompt }],
      });
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") {
        throw new Error("המודל סירב לייצר שאלות מהחומר שסופק");
      }
      const text = message.content.find((b) => b.type === "text")?.text;
      if (!text) throw new Error("לא התקבל תוכן מהמודל");
      return validateQuestions(JSON.parse(text), opts.count).map(shuffleQuestionOptions);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("יצירת השאלות נכשלה");
}
