import type { ScoreBreakdown } from "../game/types";

export function CandidateRowHelpers({ breakdown }: { breakdown: ScoreBreakdown }) {
  const parts = [
    ["base", breakdown.baseScore],
    breakdown.colorBonus > 0 ? ["mono bonus", breakdown.colorBonus] : null,
    breakdown.bonusCharacterScore > 0 ? ["bonus char.", breakdown.bonusCharacterScore] : null,
  ].filter(Boolean) as [string, number][];
  return (
    <p className="mt-0.5 text-[11px] text-white/50">
      {parts.map(([label, v], i) => (
        <span key={i}>
          {i > 0 && " + "}
          {v.toLocaleString()} {label}
        </span>
      ))}
    </p>
  );
}
