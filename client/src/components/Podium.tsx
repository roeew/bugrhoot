import Leaderboard from "./Leaderboard";

interface PodiumProps {
  ranking: { name: string; score: number; rank: number }[];
}

const MEDALS = ["🥇", "🥈", "🥉"];

export default function Podium({ ranking }: PodiumProps) {
  const top3 = ranking.slice(0, 3);
  const rest = ranking.slice(3);
  // סדר תצוגה: מקום 2 | מקום 1 | מקום 3
  const order = [top3[1], top3[0], top3[2]].filter(Boolean);

  return (
    <div>
      <div className="podium">
        {order.map((entry) => (
          <div key={entry.rank} className={`podium-slot podium-${entry.rank} pop-in`} style={{ animationDelay: `${(3 - entry.rank) * 0.3}s` }}>
            <div style={{ fontSize: "2rem" }}>{MEDALS[entry.rank - 1]}</div>
            <div className="podium-name">{entry.name}</div>
            <div className="podium-score" dir="ltr">
              {entry.score.toLocaleString()}
            </div>
            <div className="podium-block">{entry.rank}</div>
          </div>
        ))}
      </div>
      {rest.length > 0 && <Leaderboard entries={rest} />}
    </div>
  );
}
