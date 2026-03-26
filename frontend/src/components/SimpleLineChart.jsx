function buildPolyline(data, width, height, padding) {
  if (!data.length) {
    return "";
  }

  const maxValue = Math.max(...data.map((point) => point.count), 1);
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  return data
    .map((point, index) => {
      const x = padding + (index / Math.max(data.length - 1, 1)) * innerWidth;
      const y = padding + innerHeight - (point.count / maxValue) * innerHeight;
      return `${x},${y}`;
    })
    .join(" ");
}

export default function SimpleLineChart({ data }) {
  const width = 560;
  const height = 220;
  const padding = 20;
  const polylinePoints = buildPolyline(data, width, height, padding);
  const maxValue = Math.max(...data.map((point) => point.count), 1);

  return (
    <div className="chart-wrapper">
      <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img">
        <defs>
          <linearGradient id="trafficLine" x1="0%" x2="100%" y1="0%" y2="0%">
            <stop offset="0%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#0ea5e9" />
          </linearGradient>
        </defs>
        <line className="chart-axis" x1={padding} x2={padding} y1={padding} y2={height - padding} />
        <line
          className="chart-axis"
          x1={padding}
          x2={width - padding}
          y1={height - padding}
          y2={height - padding}
        />
        <polyline
          fill="none"
          points={polylinePoints}
          stroke="url(#trafficLine)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="4"
        />
      </svg>

      <div className="chart-scale">
        <span>0 req/s</span>
        <span>{maxValue} req/s peak</span>
      </div>

      <div className="chart-labels">
        {data.map((point) => (
          <span key={`${point.time}-${point.count}`}>{point.time}</span>
        ))}
      </div>
    </div>
  );
}
