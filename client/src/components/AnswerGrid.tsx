const SHAPES = ["▲", "◆", "●", "■"];

interface AnswerGridProps {
  options: string[];
  onSelect?: (index: number) => void;
  disabled?: boolean;
  selectedIndex?: number | null;
  correctIndex?: number | null;
  distribution?: [number, number, number, number] | null;
}

export default function AnswerGrid({
  options,
  onSelect,
  disabled = false,
  selectedIndex = null,
  correctIndex = null,
  distribution = null,
}: AnswerGridProps) {
  const revealed = correctIndex !== null;
  return (
    <div className="answers-grid">
      {options.map((option, i) => {
        const classes = ["answer-btn", `answer-${i}`];
        if (revealed && i === correctIndex) classes.push("correct");
        if (revealed && i !== correctIndex) classes.push("dimmed");
        if (selectedIndex === i) classes.push("selected");
        return (
          <button
            key={i}
            className={classes.join(" ")}
            disabled={disabled || revealed || !onSelect}
            onClick={() => onSelect?.(i)}
          >
            <span className="shape">{SHAPES[i]}</span>
            <span>{option}</span>
            {distribution && <span className="dist">{distribution[i]}</span>}
          </button>
        );
      })}
    </div>
  );
}
