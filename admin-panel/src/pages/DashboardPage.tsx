import type { ReactNode } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { usePolling } from "../hooks/usePolling.js";
import { fetchDashboardSummary, fetchDashboardMetrics } from "../api/endpoints.js";

// Palette per the dataviz reference instance (light mode; the admin panel has
// no dark theme). Single-series charts use categorical slot 1; the FSN status
// stack is an ordered scale, so it uses the blue ordinal ramp (validated with
// --ordinal): light = not started, dark = completed.
const SURFACE = "#fcfcfb";
const SERIES_1 = "#2a78d6";
const INK_MUTED = "#898781";
const GRIDLINE = "#e1e0d9";
const FSN_STEPS = {
  completed: { label: "Completed", color: "#1c5cab" },
  inProgress: { label: "In progress", color: "#3987e5" },
  notStarted: { label: "Not started", color: "#86b6ef" },
} as const;
type FsnKey = keyof typeof FSN_STEPS;

const AXIS_TICK = { fontSize: 12, fill: INK_MUTED };
const BAR_SIZE = 20;

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

function ChartCard({
  title,
  table,
  children,
}: {
  title: string;
  table: { headers: string[]; rows: (string | number)[][] };
  children: ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="font-semibold mb-3">{title}</h3>
      {children}
      <details className="mt-3 text-xs text-gray-600">
        <summary className="cursor-pointer select-none">Table view</summary>
        <div className="mt-2 max-h-48 overflow-auto border border-gray-200 rounded-lg">
          <table className="w-full">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                {table.headers.map((h) => (
                  <th key={h} className="px-3 py-1.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i} className="border-t border-gray-100">
                  {row.map((cell, j) => (
                    <td key={j} className="px-3 py-1.5">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function DashboardPage() {
  const { data, isOffline, loading, error } = usePolling(fetchDashboardSummary, 10000);
  const { data: metrics } = usePolling(fetchDashboardMetrics, 10000);

  if (loading) return <p className="text-gray-500">Loading…</p>;
  if (error) return <p className="text-red-600">Could not load dashboard: {error.message}</p>;

  const fsnBarData = metrics ? [{ name: "FSNs", ...metrics.fsnBreakdown }] : [];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-1">Dashboard</h2>
      {isOffline && <p className="text-amber-600 text-sm mb-4">Offline — showing last-known data.</p>}

      <div className="grid grid-cols-3 gap-4 mt-6">
        <StatCard
          label="Overall completion"
          value={data?.completion ? `${data.completion.percentComplete}%` : "—"}
          sub={
            data?.completion
              ? `${data.completion.totalBatched} / ${data.completion.totalRequired} units`
              : "No completed demand batch yet"
          }
        />
        <StatCard label="Active locks" value={String(data?.activeLockCount ?? 0)} />
        <StatCard
          label="Latest ingestion"
          value={data?.latestIngestion?.status ?? "—"}
          sub={
            data?.latestIngestion
              ? `${data.latestIngestion.filename} · ${data.latestIngestion.validRows} valid, ${data.latestIngestion.rejectedRows} rejected`
              : "No demand file uploaded yet"
          }
        />
      </div>

      {!metrics?.demandBatchId ? (
        <p className="text-gray-500 mt-6">No completed demand batch yet — charts will appear once one exists.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 mt-4">
          <ChartCard
            title="Labour productivity (units batched)"
            table={{
              headers: ["Labour", "Units batched", "Submissions"],
              rows: metrics.labourProductivity.map((r) => [r.labourName, r.unitsBatched, r.submissionCount]),
            }}
          >
            {metrics.labourProductivity.length === 0 ? (
              <p className="text-gray-500 text-sm">No labour submissions yet for this demand batch.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(120, metrics.labourProductivity.length * 36 + 40)}>
                <BarChart data={metrics.labourProductivity} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid stroke={GRIDLINE} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} stroke={GRIDLINE} />
                  <YAxis type="category" dataKey="labourName" width={110} tick={AXIS_TICK} stroke={GRIDLINE} />
                  <Tooltip
                    cursor={{ fill: GRIDLINE, opacity: 0.4 }}
                    formatter={(value, _name, props) => [
                      `${value} units (${props.payload.submissionCount} submissions)`,
                      "Batched",
                    ]}
                  />
                  <Bar
                    dataKey="unitsBatched"
                    fill={SERIES_1}
                    barSize={BAR_SIZE}
                    radius={[0, 4, 4, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard
            title="FSN completion breakdown"
            table={{
              headers: ["Status", "FSNs"],
              rows: (Object.keys(FSN_STEPS) as FsnKey[]).map((k) => [
                FSN_STEPS[k].label,
                metrics.fsnBreakdown[k],
              ]),
            }}
          >
            {metrics.fsnBreakdown.total === 0 ? (
              <p className="text-gray-500 text-sm">No FSNs in the current demand batch.</p>
            ) : (
              <ResponsiveContainer width="100%" height={130}>
                <BarChart data={fsnBarData} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid stroke={GRIDLINE} horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    domain={[0, metrics.fsnBreakdown.total]}
                    tick={AXIS_TICK}
                    stroke={GRIDLINE}
                  />
                  <YAxis type="category" dataKey="name" width={44} tick={AXIS_TICK} stroke={GRIDLINE} />
                  <Tooltip
                    cursor={false}
                    formatter={(value, name) => [`${value} FSNs`, FSN_STEPS[name as FsnKey]?.label ?? name]}
                  />
                  <Legend
                    iconType="square"
                    iconSize={10}
                    formatter={(key: string) => {
                      const step = FSN_STEPS[key as FsnKey];
                      return (
                        <span className="text-xs text-gray-600">
                          {step?.label ?? key} ({metrics.fsnBreakdown[key as FsnKey] ?? 0})
                        </span>
                      );
                    }}
                  />
                  {(Object.keys(FSN_STEPS) as FsnKey[]).map((k) => (
                    <Bar
                      key={k}
                      dataKey={k}
                      stackId="fsn"
                      fill={FSN_STEPS[k].color}
                      stroke={SURFACE}
                      strokeWidth={2}
                      barSize={BAR_SIZE}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
            <p className="text-xs text-gray-500 mt-2 text-center">
              {metrics.fsnBreakdown.total} FSNs total in the current demand batch
            </p>
          </ChartCard>

          <ChartCard
            title="Darkstore-level completion %"
            table={{
              headers: ["Darkstore", "Batched", "Required", "% complete"],
              rows: metrics.darkstoreCompletion.map((r) => [r.darkstoreId, r.batched, r.required, `${r.percentComplete}%`]),
            }}
          >
            {metrics.darkstoreCompletion.length === 0 ? (
              <p className="text-gray-500 text-sm">No darkstores in the current demand batch.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(120, metrics.darkstoreCompletion.length * 32 + 40)}>
                <BarChart data={metrics.darkstoreCompletion} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid stroke={GRIDLINE} horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} unit="%" tick={AXIS_TICK} stroke={GRIDLINE} />
                  <YAxis type="category" dataKey="darkstoreId" width={90} tick={AXIS_TICK} stroke={GRIDLINE} />
                  <Tooltip
                    cursor={{ fill: GRIDLINE, opacity: 0.4 }}
                    formatter={(value, _name, props) => [
                      `${value}% (${props.payload.batched}/${props.payload.required})`,
                      "Complete",
                    ]}
                  />
                  <Bar
                    dataKey="percentComplete"
                    fill={SERIES_1}
                    barSize={BAR_SIZE}
                    radius={[0, 4, 4, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      )}
    </div>
  );
}
