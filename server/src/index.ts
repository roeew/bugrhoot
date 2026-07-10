import "./env.js"; // חייב להיות ה-import הראשון — טוען את ‎.env לפני שאר המודולים
import express from "express";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { quizzesRouter } from "./routes/quizzes.js";
import { registerSockets } from "./sockets.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.json());

app.use("/api/quizzes", quizzesRouter);

app.get("/api/server-info", (_req, res) => {
  let lanIp: string | null = null;
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        lanIp = iface.address;
        break;
      }
    }
    if (lanIp) break;
  }
  res.json({ lanIp });
});

// בפרודקשן — הגשת ה-client הבנוי מאותו שרת (אותה צורה שתיפרס ל-VPS)
const clientDist = path.join(here, "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api|socket\.io).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: true } });
registerSockets(io);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`BugRhoot server listening on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("⚠ ANTHROPIC_API_KEY לא מוגדר — יצירת שאלות תיכשל אלא אם קיים פרופיל ant auth");
  }
});
