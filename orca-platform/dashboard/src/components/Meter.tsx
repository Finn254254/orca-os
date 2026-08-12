export function Meter({ pct }: { pct: number | undefined }) {
  if (pct === undefined) return <span className="muted">-</span>;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="meter-row">
      <div className="meter">
        <div className="meter-fill" style={{ width: `${clamped}%` }} />
      </div>
      <span>{clamped.toFixed(0)}%</span>
    </div>
  );
}
