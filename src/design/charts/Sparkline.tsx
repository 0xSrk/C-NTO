export function Sparkline({ values, width = 120, height = 28, color = 'var(--ice)', signed = false, baseline = 0 }: { values: number[]; width?: number; height?: number; color?: string; signed?: boolean; baseline?: number }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...values, signed ? baseline : Infinity);
  const max = Math.max(...values, signed ? baseline : -Infinity);
  const span = max - min || 1;
  const sx = (i: number) => (i / (values.length - 1)) * (width - 2) + 1;
  const sy = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  const stroke = signed ? (last >= baseline ? 'var(--mint)' : 'var(--ember)') : color;
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      {signed && <line x1={0} x2={width} y1={sy(baseline)} y2={sy(baseline)} stroke="rgba(255,255,255,0.15)" strokeDasharray="2 2" />}
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.3} strokeLinejoin="round" />
      <circle cx={sx(values.length - 1)} cy={sy(last)} r={2} fill={stroke} />
    </svg>
  );
}
