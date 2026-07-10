import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// pdf-parse's package entry runs a debug block when imported as ESM; the inner
// module is the actual parser
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require("pdf-parse/lib/pdf-parse.js");

export async function extractText(filename: string, mimeType: string, buffer: Buffer): Promise<string> {
  if (mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
    const result = await pdfParse(buffer);
    return result.text.trim();
  }
  const text = buffer.toString("utf-8");
  if (text.includes("�")) {
    throw new Error(`הקובץ "${filename}" אינו קובץ טקסט תקין (UTF-8) ואינו PDF`);
  }
  return text.trim();
}
