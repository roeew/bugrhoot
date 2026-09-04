// בדיקת end-to-end: מארח + שני שחקנים משחקים משחק מלא מול השרת (מצב MOCK_QUESTIONS)
import { io } from "socket.io-client";
import { zipSync, strToU8 } from "fflate";

// --- בניית מסמכי OOXML מינימליים לבדיקת חילוץ הטקסט, בלי לצרף קבצים בינאריים לריפו ---

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const docx = (...paragraphs) =>
  zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    ),
    "word/document.xml": strToU8(
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(p)}</w:t></w:r></w:p>`).join("") +
        "</w:body></w:document>",
    ),
  });

const pptx = (...lines) =>
  zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    ),
    "ppt/slides/slide1.xml": strToU8(
      '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>' +
        lines.map((l) => `<a:p><a:r><a:t>${xmlEscape(l)}</a:t></a:r></a:p>`).join("") +
        "</p:spTree></p:cSld></p:sld>",
    ),
  });

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
form.append("files", new Blob([docx("פסקה ראשונה במסמך", "פסקה שנייה במסמך")], { type: DOCX_MIME }), "מסמך.docx");
form.append("files", new Blob([pptx("כותרת השקופית", "תוכן השקופית")], { type: PPTX_MIME }), "מצגת.pptx");
const upRes = await fetch(`${URL}/api/quizzes/${quiz.id}/materials`, { method: "POST", body: form });
const upBody = await upRes.json();
assert(
  upRes.status === 201 && upBody.added.length === 3 && upBody.added.every((f) => f.chars > 0),
  `העלאת md + docx + pptx וחילוץ טקסט מכולם (${JSON.stringify(upBody.errors)})`,
);

const detail = await (await fetch(`${URL}/api/quizzes/${quiz.id}`)).json();
assert(detail.materials.length === 3, "כל הקבצים מופיעים בפרטי החידון");

// קובץ בינארי שאינו מסמך נתמך חייב להיכשל עם הודעה ברורה ולא להישמר
const badForm = new FormData();
badForm.append("files", new Blob([new Uint8Array([0, 1, 2, 3, 0xff, 0xfe])], { type: "application/octet-stream" }), "junk.bin");
const badRes = await fetch(`${URL}/api/quizzes/${quiz.id}/materials`, { method: "POST", body: badForm });
const badBody = await badRes.json();
assert(badRes.status === 400 && badBody.added.length === 0 && badBody.errors.length === 1, "קובץ בינארי לא נתמך נדחה");

// 2. משחק מלא בסוקטים
const host = io(URL);
const p1 = io(URL); // אלון — עונה נכון ומהר תמיד
const p2 = io(URL); // בת-אל — איטית, טועה בשאלה 2

// חידון ללא חומרים אינו ניתן לאירוח — הכלל נאכף בשרת ולא רק בממשק
const emptyQuiz = await (
  await fetch(`${URL}/api/quizzes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "חידון ריק" }),
  })
).json();
const emptyRes = await new Promise((r) => host.emit("host:create", { quizId: emptyQuiz.id }, r));
assert(!emptyRes.ok, `אירוח חידון ללא חומרים נדחה (${emptyRes.error ?? ""})`);
await fetch(`${URL}/api/quizzes/${emptyQuiz.id}`, { method: "DELETE" });

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
