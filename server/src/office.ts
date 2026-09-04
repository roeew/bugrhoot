// חילוץ טקסט מקבצי Office מודרניים (OOXML) — docx / pptx.
// שני הפורמטים הם ארכיוני ZIP של קבצי XML, ולכן מספיק קורא-zip קטן (fflate)
// יחד עם סורק XML שאוסף את תוכן תגיות הטקסט בסדר הופעתן במסמך.
import { unzipSync } from "fflate";

const decoder = new TextDecoder("utf-8");

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

interface XmlTextOptions {
  /** תגיות שהתוכן שלהן הוא טקסט המסמך (למשל w:t ב-Word, a:t ב-PowerPoint) */
  textTags: string[];
  /** תגיות שמסמנות סוף פסקה — הופכות לשורה חדשה */
  breakTags: string[];
  /** תגיות ריקות שמסמנות ירידת שורה או טאב בתוך פסקה */
  inlineTags?: Record<string, string>;
}

/**
 * סורק XML ומחזיר את הטקסט של התגיות המבוקשות בסדר המסמך.
 * סריקה ידנית (ולא regex) כדי לא להישבר על '>' בתוך ערכי מאפיינים.
 */
export function xmlText(xml: string, options: XmlTextOptions): string {
  const textTags = new Set(options.textTags);
  const breakTags = new Set(options.breakTags);
  const inlineTags = options.inlineTags ?? {};
  const out: string[] = [];
  let depthInText = 0;
  let i = 0;

  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) {
      if (depthInText > 0) out.push(decodeEntities(xml.slice(i)));
      break;
    }
    if (depthInText > 0 && lt > i) out.push(decodeEntities(xml.slice(i, lt)));

    // דילוג על הערות, CDATA והוראות עיבוד
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      i = end === -1 ? xml.length : end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      const stop = end === -1 ? xml.length : end;
      if (depthInText > 0) out.push(xml.slice(lt + 9, stop));
      i = end === -1 ? xml.length : end + 3;
      continue;
    }

    // איתור סוף התגית תוך כיבוד מרכאות במאפיינים
    let j = lt + 1;
    let quote: string | null = null;
    while (j < xml.length) {
      const ch = xml[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      }
      j++;
    }
    if (j >= xml.length) break;

    const raw = xml.slice(lt + 1, j);
    const isClosing = raw.startsWith("/");
    const isSelfClosing = raw.endsWith("/");
    const name = raw.replace(/^\//, "").replace(/\/$/, "").trim().split(/[\s/>]/)[0];

    if (textTags.has(name)) {
      if (isSelfClosing) {
        /* <w:t/> ריק — אין מה לאסוף */
      } else if (isClosing) {
        depthInText = Math.max(0, depthInText - 1);
      } else {
        depthInText++;
      }
    } else if (isClosing && breakTags.has(name)) {
      out.push("\n");
    } else if (!isClosing && inlineTags[name] !== undefined) {
      out.push(inlineTags[name]);
    }

    i = j + 1;
  }

  return out.join("");
}

/** מנקה רווחים עודפים ושורות ריקות כפולות שנוצרות מפסקאות ריקות במסמך */
function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unzip(buffer: Buffer, filename: string): Record<string, Uint8Array> {
  try {
    return unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error(`הקובץ "${filename}" אינו קובץ Office תקין (לא ניתן לפתוח את הארכיון)`);
  }
}

/** מיון קבצים לפי המספר בשמם (slide2 לפני slide10) */
function slideNumber(path: string): number {
  const match = /(\d+)\.xml$/.exec(path);
  return match ? Number(match[1]) : 0;
}

const WORD_INLINE = { "w:br": "\n", "w:cr": "\n", "w:tab": "\t" };

export function extractDocx(filename: string, buffer: Buffer): string {
  const zip = unzip(buffer, filename);
  // גוף המסמך (כולל טבלאות ותיבות טקסט), ואחריו הערות שוליים וסיום
  const parts = ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"];
  const chunks: string[] = [];
  for (const part of parts) {
    const entry = zip[part];
    if (!entry) continue;
    const text = tidy(
      xmlText(decoder.decode(entry), {
        textTags: ["w:t", "w:delText"],
        breakTags: ["w:p"],
        inlineTags: WORD_INLINE,
      }),
    );
    if (text) chunks.push(text);
  }
  if (!zip["word/document.xml"]) {
    throw new Error(`הקובץ "${filename}" אינו מסמך Word תקין (חסר word/document.xml)`);
  }
  return chunks.join("\n\n");
}

export function extractPptx(filename: string, buffer: Buffer): string {
  const zip = unzip(buffer, filename);
  const slides = Object.keys(zip)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  if (slides.length === 0) {
    throw new Error(`הקובץ "${filename}" אינו מצגת PowerPoint תקינה (לא נמצאו שקופיות)`);
  }

  const readXml = (path: string) =>
    tidy(
      xmlText(decoder.decode(zip[path]), {
        textTags: ["a:t"],
        breakTags: ["a:p"],
        inlineTags: { "a:br": "\n" },
      }),
    );

  const chunks: string[] = [];
  for (const path of slides) {
    const num = slideNumber(path);
    const body = readXml(path);
    const notesPath = `ppt/notesSlides/notesSlide${num}.xml`;
    const notes = zip[notesPath] ? readXml(notesPath) : "";
    const parts = [`— שקופית ${num} —`];
    if (body) parts.push(body);
    if (notes) parts.push(`[הערות המרצה]\n${notes}`);
    if (body || notes) chunks.push(parts.join("\n"));
  }
  return chunks.join("\n\n");
}
