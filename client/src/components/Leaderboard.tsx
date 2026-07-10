interface LeaderboardProps {
  entries: { name: string; score: number }[];
}

export default function Leaderboard({ entries }: LeaderboardProps) {
  return (
    <div className="leaderboard">
      {entries.map((entry, i) => (
        <div className="leaderboard-row pop-in" key={entry.name} style={{ animationDelay: `${i * 0.08}s` }}>
          <span>
            {i + 1}. {entry.name}
          </span>
          <span dir="ltr">{entry.score.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
