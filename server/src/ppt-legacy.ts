// חילוץ טקסט ממצגות PowerPoint 97-2003 (.ppt).
// הפורמט הוא Compound File Binary (OLE2): "מערכת קבצים" בתוך קובץ, ובתוכה
// הזרם "PowerPoint Document" — עץ רשומות בינאריות שבו הטקסט יושב באטומים
// ייעודיים. אין ל-JS ספרייה קטנה ואמינה לפורמט הזה, ולכן שני השלבים כאן.

const CFB_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

// ---- שלב 1: קריאת מכולת ה-CFB ----

interface DirEntry {
  name: string;
  type: number; // 1=storage, 2=stream, 5=root
  start: number;
  size: number;
}

export function readCfbStreams(buffer: Buffer): Map<string, Buffer> {
  if (buffer.length < 512 || !buffer.subarray(0, 8).equals(CFB_SIGNATURE)) {
    throw new Error("cfb: חתימת הקובץ אינה של מסמך Office ישן");
  }
  const sectorSize = 1 << buffer.readUInt16LE(30);
  const miniSectorSize = 1 << buffer.readUInt16LE(32);
  const firstDirSector = buffer.readUInt32LE(48);
  const miniCutoff = buffer.readUInt32LE(56);
  const firstMiniFatSector = buffer.readUInt32LE(60);
  const firstDifatSector = buffer.readUInt32LE(68);
  const numDifatSectors = buffer.readUInt32LE(72);
  if (sectorSize < 128 || sectorSize > 1 << 20 || miniSectorSize < 8) {
    throw new Error("cfb: גודל סקטור לא תקין");
  }

  const readSector = (id: number): Buffer => {
    const offset = (id + 1) * sectorSize;
    if (offset < 0 || offset + sectorSize > buffer.length) throw new Error("cfb: סקטור מחוץ לגבולות הקובץ");
    return buffer.subarray(offset, offset + sectorSize);
  };

  // DIFAT — רשימת הסקטורים שמרכיבים את טבלת ה-FAT
  const fatSectorIds: number[] = [];
  for (let i = 0; i < 109; i++) {
    const id = buffer.readUInt32LE(76 + i * 4);
    if (id !== FREESECT && id !== ENDOFCHAIN) fatSectorIds.push(id);
  }
  let difat = firstDifatSector;
  for (let n = 0; n <= numDifatSectors && difat !== ENDOFCHAIN && difat !== FREESECT; n++) {
    const sector = readSector(difat);
    const perSector = sectorSize / 4 - 1;
    for (let i = 0; i < perSector; i++) {
      const id = sector.readUInt32LE(i * 4);
      if (id !== FREESECT && id !== ENDOFCHAIN) fatSectorIds.push(id);
    }
    difat = sector.readUInt32LE(perSector * 4);
  }

  const fat: number[] = [];
  for (const id of fatSectorIds) {
    const sector = readSector(id);
    for (let i = 0; i < sectorSize / 4; i++) fat.push(sector.readUInt32LE(i * 4));
  }

  /** שרשרת סקטורים לפי טבלה נתונה, עם הגנה מפני לולאה בקובץ פגום */
  const followChain = (start: number, table: number[]): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    let id = start;
    while (id !== ENDOFCHAIN && id !== FREESECT && id >= 0 && id < table.length && !seen.has(id)) {
      seen.add(id);
      out.push(id);
      id = table[id];
    }
    return out;
  };

  const readStreamFat = (start: number, size: number): Buffer => {
    const data = Buffer.concat(followChain(start, fat).map(readSector));
    return size >= 0 && size < data.length ? data.subarray(0, size) : data;
  };

  // ספריית הקבצים הפנימית — רשומות של 128 בתים
  const dir = readStreamFat(firstDirSector, -1);
  const entries: DirEntry[] = [];
  for (let off = 0; off + 128 <= dir.length; off += 128) {
    const type = dir.readUInt8(off + 66);
    if (type !== 1 && type !== 2 && type !== 5) continue;
    const nameLen = dir.readUInt16LE(off + 64);
    const name = nameLen > 2 ? dir.toString("utf16le", off, off + Math.min(nameLen, 64) - 2) : "";
    const start = dir.readUInt32LE(off + 116);
    const sizeLow = dir.readUInt32LE(off + 120);
    const sizeHigh = dir.readUInt32LE(off + 124);
    // בקבצים עם סקטור 512 המילה העליונה אינה אמינה — מתעלמים ממנה
    const size = sectorSize === 512 ? sizeLow : sizeLow + sizeHigh * 2 ** 32;
    entries.push({ name, type, start, size });
  }

  // ה-mini stream (לזרמים קטנים) יושב כזרם רגיל תחת ערך השורש
  const root = entries.find((e) => e.type === 5);
  let miniStream: Buffer = Buffer.alloc(0);
  const miniFat: number[] = [];
  if (root) {
    miniStream = readStreamFat(root.start, root.size);
    for (const id of followChain(firstMiniFatSector, fat)) {
      const sector = readSector(id);
      for (let i = 0; i < sectorSize / 4; i++) miniFat.push(sector.readUInt32LE(i * 4));
    }
  }
  const readStreamMini = (start: number, size: number): Buffer => {
    const parts = followChain(start, miniFat).map((id) =>
      miniStream.subarray(id * miniSectorSize, id * miniSectorSize + miniSectorSize),
    );
    const data = Buffer.concat(parts);
    return size >= 0 && size < data.length ? data.subarray(0, size) : data;
  };

  const streams = new Map<string, Buffer>();
  for (const entry of entries) {
    if (entry.type !== 2 || !entry.name) continue;
    try {
      streams.set(
        entry.name,
        entry.size < miniCutoff ? readStreamMini(entry.start, entry.size) : readStreamFat(entry.start, entry.size),
      );
    } catch {
      /* זרם פגום — מדלגים עליו במקום להפיל את כל הקובץ */
    }
  }
  return streams;
}

// ---- שלב 2: מעבר על עץ הרשומות של PowerPoint ----

const RT_DOCUMENT = 0x03e8;
const RT_SLIDE = 0x03ee;
const RT_NOTES = 0x03f0;
const RT_MAIN_MASTER = 0x03f8;
const RT_TEXT_CHARS_ATOM = 0x0fa0; // טקסט ב-UTF-16LE
const RT_TEXT_BYTES_ATOM = 0x0fa8; // בית לתו (החלק הנמוך של UTF-16)
const RT_SLIDE_LIST_WITH_TEXT = 0x0ff0;
const RT_CRYPT_SESSION_10 = 0x2f14;

interface Record {
  version: number; // 0x0f מסמן מכולה שיש להיכנס אליה
  instance: number;
  type: number;
  body: Buffer;
}

/** פירוק שכבה אחת של רשומות: כותרת של 8 בתים ואחריה הגוף */
function* records(buf: Buffer): Generator<Record> {
  let off = 0;
  while (off + 8 <= buf.length) {
    const verInstance = buf.readUInt16LE(off);
    const type = buf.readUInt16LE(off + 2);
    const length = buf.readUInt32LE(off + 4);
    const start = off + 8;
    const end = Math.min(start + length, buf.length);
    yield { version: verInstance & 0x0f, instance: verInstance >> 4, type, body: buf.subarray(start, end) };
    off = end; // רשומה באורך 0 עדיין מקדמת ב-8 בתים, כך שאין לולאה אינסופית
  }
}

function collectText(buf: Buffer, out: string[], depth: number): void {
  for (const record of records(buf)) {
    if (record.version === 0x0f) {
      if (depth < 24) collectText(record.body, out, depth + 1);
    } else if (record.type === RT_TEXT_CHARS_ATOM) {
      out.push(record.body.toString("utf16le", 0, record.body.length - (record.body.length % 2)));
    } else if (record.type === RT_TEXT_BYTES_ATOM) {
      let text = "";
      for (const byte of record.body) text += String.fromCharCode(byte);
      out.push(text);
    }
  }
}

/**
 * טקסט של placeholder (כותרת וגוף) נשמר ברשימת הטקסט של מכולת המסמך,
 * ואילו תיבות טקסט חופשיות נשמרות בתוך השקופית עצמה — לכן נאספים שני המקורות.
 * תבניות האב מדולגות, אחרת מתקבל "Click to edit Master title style" בכל קובץ.
 */
function walkPresentation(buf: Buffer): string[] {
  const out: string[] = [];
  for (const record of records(buf)) {
    if (record.version !== 0x0f) continue;
    if (record.type === RT_DOCUMENT) {
      for (const child of records(record.body)) {
        // instance 0 = תבניות אב, 1 = שקופיות, 2 = הערות
        if (child.type === RT_SLIDE_LIST_WITH_TEXT && (child.instance === 1 || child.instance === 2)) {
          collectText(child.body, out, 1);
        }
      }
    } else if (record.type === RT_SLIDE || record.type === RT_NOTES) {
      collectText(record.body, out, 1);
    }
  }
  if (out.length > 0) return out;

  // מבנה לא צפוי — סריקה רחבה שמדלגת רק על תבניות האב
  for (const record of records(buf)) {
    if (record.version === 0x0f && record.type !== RT_MAIN_MASTER) collectText(record.body, out, 1);
  }
  return out;
}

function isEncrypted(buf: Buffer): boolean {
  for (const record of records(buf)) {
    if (record.type === RT_CRYPT_SESSION_10) return true;
  }
  return false;
}

/** \r הוא סוף פסקה בפורמט, \v שבירת שורה; שאר תווי הבקרה הם ריפוד */
function tidyPptText(chunks: string[]): string {
  return chunks
    .join("\n")
    .replace(/\r\n?/g, "\n")
    .replace(/\v/g, "\n")
    .replace(/[\u0000-\u0008\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractLegacyPpt(filename: string, buffer: Buffer): string {
  let streams: Map<string, Buffer>;
  try {
    streams = readCfbStreams(buffer);
  } catch {
    throw new Error(`הקובץ "${filename}" אינו מצגת PowerPoint 97-2003 תקינה`);
  }
  const document = streams.get("PowerPoint Document");
  if (!document) {
    throw new Error(`הקובץ "${filename}" אינו מצגת PowerPoint תקינה (לא נמצא זרם המצגת)`);
  }
  if (isEncrypted(document)) {
    throw new Error(`המצגת "${filename}" מוגנת בסיסמה — הסירו את ההגנה או שמרו אותה כ-pptx`);
  }
  return tidyPptText(walkPresentation(document));
}
