# BugRhoot — שרת יחיד שמגיש גם את הפרונט (Railway / Render / Fly.io / כל מארח קונטיינרים)
FROM node:22-slim

WORKDIR /app

# התקנת תלויות (שכבה נפרדת לניצול cache)
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci

# קוד + בניית ה-client
COPY . .
RUN npm run build

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

# מסד הנתונים נשמר ב-/data — יש למפות לשם volume מתמשך בפלטפורמה (Railway Volumes וכו')
EXPOSE 3000

CMD ["npm", "start"]
