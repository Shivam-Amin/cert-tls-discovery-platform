// Chart cards built on Recharts. Data is always [{ name, value }] unless noted.
// Colours come from styles.css via theme.js. Animations are off: pages
// refresh while scans run, and re-animating on every refresh looks jumpy.
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { chartPalette, cssVar, statusColor } from '../theme.js';

const HEIGHT = 240;

export function ChartCard({ title, subtitle, children, empty }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {subtitle && <div className="muted small" style={{ marginTop: -8, marginBottom: 8 }}>{subtitle}</div>}
      {empty ? <div className="chart-empty">No data</div> : children}
    </div>
  );
}

function axisProps() {
  const color = cssVar('--text-muted');
  return { tick: { fill: color, fontSize: 13 }, stroke: cssVar('--border') };
}

// Horizontal bars, good for long labels (issuers, cipher suites, endpoints).
export function BarListChart({ title, subtitle, data, colorIndex = 0, labelWidth = 170 }) {
  const color = chartPalette()[colorIndex];
  const height = Math.max(HEIGHT, data.length * 28 + 40);
  return (
    <ChartCard title={title} subtitle={subtitle} empty={data.length === 0}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={cssVar('--border')} horizontal={false} />
          <XAxis type="number" allowDecimals={false} {...axisProps()} />
          <YAxis type="category" dataKey="name" width={labelWidth} interval={0} {...axisProps()} />
          <Tooltip />
          <Bar dataKey="value" name="count" fill={color} radius={[0, 3, 3, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// Vertical bars, good for short labels or time buckets.
export function ColumnChart({ title, subtitle, data, colorIndex = 0, valueName = 'count' }) {
  const color = chartPalette()[colorIndex];
  return (
    <ChartCard title={title} subtitle={subtitle} empty={data.length === 0}>
      <ResponsiveContainer width="100%" height={HEIGHT}>
        <BarChart data={data} margin={{ right: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={cssVar('--border')} vertical={false} />
          <XAxis dataKey="name" {...axisProps()} />
          <YAxis allowDecimals={false} {...axisProps()} />
          <Tooltip />
          <Bar dataKey="value" name={valueName} fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// Donut. If byStatus, slices are coloured by their name (valid, expired, ...).
export function DonutChart({ title, subtitle, data, byStatus = false }) {
  const palette = chartPalette();
  const shown = data.filter((d) => d.value > 0);
  return (
    <ChartCard title={title} subtitle={subtitle} empty={shown.length === 0}>
      <ResponsiveContainer width="100%" height={HEIGHT}>
        <PieChart>
          <Pie data={shown} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={1} isAnimationActive={false}>
            {shown.map((d, i) => (
              <Cell key={d.name} fill={byStatus ? statusColor(d.key ?? d.name) : palette[i % palette.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// Stacked bars. data: [{ name, a: 1, b: 2 }], series: [{ key, label, color }]
export function StackedChart({ title, subtitle, data, series }) {
  return (
    <ChartCard title={title} subtitle={subtitle} empty={data.length === 0}>
      <ResponsiveContainer width="100%" height={HEIGHT}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={cssVar('--border')} vertical={false} />
          <XAxis dataKey="name" {...axisProps()} />
          <YAxis allowDecimals={false} {...axisProps()} />
          <Tooltip />
          <Legend />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} stackId="stack" fill={s.color} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// Lines over runs. data: [{ name, a: 1, b: null }], series: [{ key, label, color }]
export function TrendChart({ title, subtitle, data, series, unit }) {
  return (
    <ChartCard title={title} subtitle={subtitle} empty={data.length === 0}>
      <ResponsiveContainer width="100%" height={HEIGHT}>
        <LineChart data={data} margin={{ right: 12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={cssVar('--border')} vertical={false} />
          <XAxis dataKey="name" {...axisProps()} />
          <YAxis allowDecimals={false} unit={unit} {...axisProps()} />
          <Tooltip />
          <Legend />
          {series.map((s) => (
            <Line
              key={s.key}
              type="linear"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
