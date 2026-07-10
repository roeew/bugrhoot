import { io, Socket } from "socket.io-client";

// אותו origin — ה-proxy של Vite (בפיתוח) או השרת עצמו (בפרודקשן)
export const socket: Socket = io({ autoConnect: true });
