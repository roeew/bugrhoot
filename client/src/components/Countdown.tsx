import { useEffect, useState } from "react";

interface CountdownProps {
  totalMs: number;
  /** שינוי המפתח מאתחל את הספירה (למשל אינדקס השאלה) */
  resetKey: number;
  running: boolean;
}

export default function Countdown({ totalMs, resetKey, running }: CountdownProps) {
  const [remaining, setRemaining] = useState(totalMs);

  useEffect(() => {
    setRemaining(totalMs);
    if (!running) return;
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const left = Math.max(totalMs - (Date.now() - startedAt), 0);
      setRemaining(left);
      if (left === 0) clearInterval(interval);
    }, 100);
    return () => clearInterval(interval);
  }, [resetKey, totalMs, running]);

  return (
    <div className="countdown" dir="ltr">
      <div className="bar">
        <div className="bar-fill" style={{ width: `${(remaining / totalMs) * 100}%` }} />
      </div>
      <span className="seconds">{Math.ceil(remaining / 1000)}</span>
    </div>
  );
}
