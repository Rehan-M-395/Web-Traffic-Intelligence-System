export default function MetricCard({ title, value, caption }) {
  return (
    <article className="metric-card glass-panel">
      <p className="section-label">{title}</p>
      <h3>{value}</h3>
      <p className="muted-copy">{caption}</p>
    </article>
  );
}
