import { createRequire } from "node:module";
import WordExtractor from "word-extractor";
import { extractDocx, extractPptx } from "./office.js";
import { extractLegacyPpt } from "./ppt-legacy.js";

const require = createRequire(import.meta.url);
// pdf-parse's package entry runs a debug block when imported as ESM; the inner
// module is the actual parser
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require("pdf-parse/lib/pdf-parse.js");

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

/**
 * מזהה את סוג הקובץ לפי הסיומת, ואם היא חסרה או מטעה — לפי חתימת הבתים.
 * העלאות מהדפדפן מגיעות לעיתים עם mime type גנרי, ולכן החתימה קובעת בספק.
 */
function detectKind(filename: string, mimeType: string, buffer: Buffer): string {
  const ext = extensionOf(filename);
  const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK"
  const isOle2 = buffer.length > 8 && buffer.readUInt32LE(0) === 0xe011cfd0 && buffer.readUInt32LE(4) === 0xe11ab1a1;
  const isPdf = buffer.length > 4 && buffer.toString("latin1", 0, 5) === "%PDF-";

  if (ext === ".pdf" || mimeType === "application/pdf" || isPdf) return "pdf";
  if (ext === ".docx" && isZip) return "docx";
  if (ext === ".pptx" && isZip) return "pptx";
  if (ext === ".doc" && isOle2) return "doc";
  if (ext === ".ppt" && isOle2) return "ppt";

  // סיומת שגויה (למשל pptx ששמור כ-ppt) — מכריעים לפי החתימה ולפי ה-mime
  if (isZip) {
    if (/presentation/i.test(mimeType) || ext === ".ppt" || ext === ".pptx") return "pptx";
    if (/word|document/i.test(mimeType) || ext === ".doc" || ext === ".docx") return "docx";
  }
  if (isOle2) {
    if (/powerpoint/i.test(mimeType) || ext === ".ppt" || ext === ".pptx") return "ppt";
    if (/word|msword/i.test(mimeType) || ext === ".doc" || ext === ".docx") return "doc";
    return "ole2";
  }
  return "text";
}

const wordExtractor = new WordExtractor();

export async function extractText(filename: string, mimeType: string, buffer: Buffer): Promise<string> {
  switch (detectKind(filename, mimeType, buffer)) {
    case "pdf": {
      const result = await pdfParse(buffer);
      return result.text.trim();
    }
    case "docx":
      return extractDocx(filename, buffer).trim();
    case "pptx":
      return extractPptx(filename, buffer).trim();
    case "doc": {
      const document = await wordExtractor.extract(buffer);
      // גוף המסמך ואחריו הערות שוליים/סיום, אם יש
      return [document.getBody(), document.getFootnotes(), document.getEndnotes()]
        .map((part) => (part ?? "").replace(/\r\n?/g, "\n").trim())
        .filter(Boolean)
        .join("\n\n")
        .trim();
    }
    case "ppt":
      return extractLegacyPpt(filename, buffer).trim();
    case "ole2":
      throw new Error(`הקובץ "${filename}" הוא מסמך Office ישן שאינו נתמך — שמרו אותו כ-docx, pptx או PDF`);
    default: {
      const text = buffer.toString("utf-8");
      if (text.includes("�")) {
        throw new Error(`הקובץ "${filename}" אינו קובץ טקסט תקין (UTF-8) ואינו מסמך נתמך (PDF, Word או PowerPoint)`);
      }
      return text.trim();
    }
  }
}
