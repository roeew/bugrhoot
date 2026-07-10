// בדיקת end-to-end: מארח + שני שחקנים משחקים משחק מלא מול השרת (מצב MOCK_QUESTIONS)
import { io } from "socket.io-client";

const URL = process.env.E2E_URL ?? "http://localhost:3000";
const log = (...a) => console.log(...a);
const assert = (cond, msg) => {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  log("PASS:", msg);
};

// 1. יצירת חידון + העלאת חומר דרך ה-REST API
const quizRes = await fetch(`${URL}/api/quizzes`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: "חידון בדיקה", question_count: 3, question_time_sec: 6 }),
});
const quiz = await quizRes.json();
assert(quizRes.status === 201 && quiz.id, "יצירת חידון דרך ה-API");

const form = new FormData();
form.append("files", new Blob(["# React\nuseState מחזיר זוג: ערך ופונקציית עדכון.\n```js\nconst [n, setN] = useState(0);\n```"], { type: "text/markdown" }), "notes.md");
const upRes = await fetch(`${URL}/api/quizzes/${quiz.id}/materials`, { method: "POST", body: form });
const upBody = await upRes.json();
assert(upRes.status === 201 && upBody.added.length === 1 && upBody.added[0].chars > 0, "העלאת קובץ וחילוץ טקסט");

const detail = await (await fetch(`${URL}/api/quizzes/${quiz.id}`)).json();
assert(detail.materials.length === 1, "הקובץ מופיע בפרטי החידון");

// 2. משחק מלא בסוקטים
const host = io(URL);
const p1 = io(URL); // אלון — עונה נכון ומהר תמיד
const p2 = io(URL); // בת-אל — איטית, טועה בשאלה 2

const createRes = await new Promise((r) => host.emit("host:create", { quizId: quiz.id }, r));
assert(createRes.ok, "המארח פתח משחק");
const pin = createRes.pin;
assert(/^\d{6}$/.test(pin), `PIN בן 6 ספרות (${pin})`);

await new Promise((resolve, reject) => {
  if (createRes.questionsReady) return resolve();
  host.on("game:lobby", (s) => {
    if (s.generationError) reject(new Error(s.generationError));
    else if (s.questionsReady) resolve();
  });
});
log("PASS: השאלות נוצרו (mock)");

for (const [sock, name] of [[p1, "אלון"], [p2, "בת-אל"]]) {
  const res = await new Promise((r) => sock.emit("player:join", { pin, name }, r));
  assert(res.ok, `${name} הצטרף`);
}
const dup = await new Promise((r) => p2.emit("player:join", { pin: "000000", name: "x" }, r));
assert(!dup.ok, "PIN שגוי נדחה");

const results = { p1: [], p2: [] };
let sawCorrectIndexLeak = false;
// האפשרויות מעורבבות ע"י השרת — מאתרים את התשובה הנכונה של שאלת ה-mock לפי הטקסט שלה
const MOCK_OPTIONS = ["תשובה א", "תשובה ב", "תשובה ג", "תשובה ד"];
const correctIdxOf = (q) => q.options.indexOf(MOCK_OPTIONS[q.index % 4]);
const shuffledPositions = new Set();
p1.on("game:question", (q) => {
  if ("correctIndex" in q) sawCorrectIndexLeak = true;
  const idx = correctIdxOf(q);
  shuffledPositions.add(idx);
  setTimeout(() => p1.emit("player:answer", { index: idx }), 300);
});
p2.on("game:question", (q) => {
  const correct = correctIdxOf(q);
  const idx = q.index === 1 ? (correct + 1) % 4 : correct;
  setTimeout(() => p2.emit("player:answer", { index: idx }), 2500);
});
p1.on("player:result", (r) => results.p1.push(r));
p2.on("player:result", (r) => results.p2.push(r));

host.emit("host:start");
const podium = await new Promise((resolve) => {
  host.on("game:reveal", (r) => {
    log(`reveal: dist=${JSON.stringify(r.distribution)} isLast=${r.isLast}`);
    setTimeout(() => host.emit("host:next"), 200);
  });
  host.on("game:podium", resolve);
});

log("podium:", JSON.stringify(podium.ranking));
log("p1:", JSON.stringify(results.p1.map((r) => ({ c: r.correct, pts: r.points, total: r.totalScore, rank: r.rank, streak: r.streak }))));
log("p2:", JSON.stringify(results.p2.map((r) => ({ c: r.correct, pts: r.points, total: r.totalScore, rank: r.rank, streak: r.streak }))));

// 3. בדיקות
assert(!sawCorrectIndexLeak, "התשובה הנכונה לא דלפה לשחקנים לפני reveal");
log(`shuffle: התשובה הנכונה הופיעה במיקומים ${[...shuffledPositions].sort().join(",")}`);
assert(results.p1.length === 3 && results.p2.length === 3, "שלושה סבבי תוצאה לכל שחקן");
assert(results.p1.every((r) => r.correct), "אלון ענה נכון על הכול");
assert(results.p2[1].correct === false, "בת-אל טעתה בשאלה 2");
assert(results.p1[0].points > results.p2[0].points, "עונה מהיר מקבל יותר נקודות מעונה איטי");
assert(results.p1[2].streak === 3, "רצף של אלון = 3 בסוף");
assert(results.p1[2].points > results.p1[0].points, "בונוס רצף מגדיל את הנקודות");
assert(podium.ranking[0].name === "אלון" && podium.ranking[0].rank === 1, "אלון במקום הראשון בפודיום");
assert(podium.ranking.length === 2, "כל השחקנים בדירוג הסופי");

// ניקוי
await fetch(`${URL}/api/quizzes/${quiz.id}`, { method: "DELETE" });
console.log("\nALL E2E CHECKS PASSED ✅");
process.exit(0);
