// נטען כ-import הראשון ב-index.ts, כך שכל שאר המודולים רואים את משתני ‎.env
// (ב-ESM ה-imports מוערכים לפי הסדר, לפני גוף הקובץ)
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: [path.join(here, "../../.env"), path.join(here, "../.env")] });
