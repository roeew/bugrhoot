/**
 * הגנת אדמין אופציונלית: אם ADMIN_PASSWORD מוגדר בסביבה, כל פעולות האדמין
 * (ניהול חידונים + פתיחת משחק) דורשות אותו. אם לא מוגדר — אין הגנה (פיתוח מקומי).
 * חובה להגדיר בפריסה לאינטרנט, אחרת כל גולש יוכל לשרוף קרדיטים של ה-API.
 */
export function isAdminKeyValid(key: unknown): boolean {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return true;
  return typeof key === "string" && key === password;
}

export const ADMIN_REQUIRED_ERROR = "נדרשת סיסמת אדמין";
