import { useEffect, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  BarChart, Bar, ScatterChart, Scatter, ZAxis, ReferenceLine, LabelList, PieChart, Pie, Cell,
} from "recharts";

const USED = "#2f4cdd", GAP = "#f2a900";
const SEG_COLORS = { Power: "#2f4cdd", Regular: "#6f86ee", Light: "#b7c3f6", Lapsed: "#f2a900", "Never used": "#c9ced6" };
const APPS = [["chat", "Chat"], ["teams", "Teams"], ["word", "Word"], ["excel", "Excel"], ["powerpoint", "PowerPoint"], ["onenote", "OneNote"]];

const usd = (n) => (n == null ? "–" : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const fmtDate = (v) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–");
const num = (n) => (n == null ? "–" : Math.round(n).toLocaleString());

function useApi(path, params = {}) {
  const [s, set] = useState({ data: null, error: null, loading: true });
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "")).toString();
  useEffect(() => {
    let alive = true;
    set((p) => ({ ...p, loading: true }));
    fetch(`/api/${path}${qs ? `?${qs}` : ""}`)
      .then((r) => { if (!r.ok) throw new Error(`API returned ${r.status}`); return r.json(); })
      .then((data) => alive && set({ data, error: null, loading: false }))
      .catch((e) => alive && set({ data: null, error: e.message, loading: false }));
    return () => { alive = false; };
  }, [path, qs]);
  return s;
}

function Panel({ title, note, state, children, action }) {
  return (
    <section className="panel">
      <div className="phead"><h2>{title}</h2>{action}</div>
      {note && <p className="note">{note}</p>}
      {state.error ? <div className="msg err">Could not load: {state.error}. Check that the API is running.</div>
        : !state.data ? <div className="msg">Loading…</div>
        : Array.isArray(state.data) && !state.data.length ? <div className="msg">No data yet for this view.</div>
        : children(state.data)}
    </section>
  );
}

function Kpis({ scope }) {
  const { data: k, error } = useApi("kpis", scope);
  if (error) return <div className="msg err">Could not load KPIs: {error}</div>;
  if (!k) return <div className="msg">Loading…</div>;
  const cards = [
    { l: "Licenses assigned", v: num(k.licensed), s: `${usd(k.monthly_spend)} per month${k.purchased_seats != null ? ` · ${num(k.purchased_seats)} in tenant summary` : ""}` },
    { l: "Active users (28 days)", v: num(k.active), s: `${k.utilization_pct}% of licenses · ${num(k.idle)} idle` },
    { l: "Weekly active users", v: num(k.wau), s: "active in the last 7 days" },
    { l: "Prompts (28 days)", v: num(k.prompts), s: `${num(k.prompts_work)} work, ${num(k.prompts_web)} web` },
    { l: "Prompts per active user", v: num(k.avg_prompts_per_active), s: "work + web" },
  ];
  return (
    <div className="kpis">
      {cards.map((c) => (
        <div key={c.l} className={`kpi ${c.gap ? "gap" : ""}`}>
          <div className="l">{c.l}</div><div className="v">{c.v}</div><small>{c.s}</small>
        </div>
      ))}
    </div>
  );
}

function Trend() {
  const [grain, setGrain] = useState("week");
  const st = useApi("trend", { grain });
  const label = (r) => {
    const d = new Date(`${r.period_start}T00:00:00`);
    return grain === "week"
      ? `Wk of ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
      : d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  };
  const last = st.data?.rows?.[st.data.rows.length - 1];
  const toggle = (
    <div className="seg">
      <button aria-pressed={grain === "week"} onClick={() => setGrain("week")}>Weekly</button>
      <button aria-pressed={grain === "month"} onClick={() => setGrain("month")}>Monthly</button>
    </div>
  );
  return (
    <Panel title="Active users trend" action={toggle} state={st}
      note={st.data?.as_of
        ? `Active vs licensed users at the end of each ${grain}. Latest data: ${fmtDate(st.data.as_of)}${last?.partial ? `; the current ${grain} is still in progress` : ""}. Company-wide.`
        : "Company-wide."}>
      {(d) => !d.rows.length ? <div className="msg">No trend data yet.</div> : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={d.rows.map((r) => ({ ...r, label: label(r) }))} margin={{ left: -10, right: 8 }}>
            <CartesianGrid stroke="#e6e9ee" vertical={false} />
            <XAxis dataKey="label" minTickGap={20} /><YAxis />
            <Tooltip content={({ payload }) => {
              const p = payload?.[0]?.payload; if (!p) return null;
              return <div className="panel" style={{ padding: 8 }}><b>{p.label}</b>{p.partial ? " (in progress)" : ""}<br />
                {num(p.active)} active of {num(p.enabled)} licensed ({p.utilization_pct}%)<br />Data through {fmtDate(p.last_day)}</div>;
            }} />
            <Legend />
            <Line type="monotone" dataKey="enabled" name="Licensed" stroke={GAP} strokeDasharray="5 4" dot={{ r: 3 }} strokeWidth={2} />
            <Line type="monotone" dataKey="active" name="Active" stroke={USED} dot={{ r: 3 }} strokeWidth={2.5} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

function DeptUsage({ asOf }) {
  const st = useApi("departments");
  return (
    <Panel title="Active users by department" state={st}
      note={`Active users out of the licensed users in each department. Data as of ${fmtDate(asOf)}.`}>
      {(d) => {
        const rows = [...d].sort((a, b) => b.licensed - a.licensed).map((r) => ({
          name: r.name, active: r.active, idle: r.licensed - r.active,
          label: `${r.active} of ${r.licensed} (${r.utilization_pct}%)`,
        }));
        return (
          <ResponsiveContainer width="100%" height={Math.max(260, rows.length * 34 + 60)}>
            <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 110 }}>
              <CartesianGrid stroke="#e6e9ee" horizontal={false} />
              <XAxis type="number" /><YAxis type="category" dataKey="name" width={110} />
              <Tooltip /><Legend />
              <Bar dataKey="active" name="Active" stackId="u" fill={USED} />
              <Bar dataKey="idle" name="Licensed, not active" stackId="u" fill="#d9dee8">
                <LabelList dataKey="label" position="right" style={{ fontSize: 12, fill: "#5d6b7a" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );
      }}
    </Panel>
  );
}

function DeptTable({ sel, onPick }) {
  const st = useApi("departments");
  return (
    <Panel title="Departments" note="Lowest utilization first. Click a row to filter the page." state={st}>
      {(d) => (
        <div className="scroll">
          <table>
            <thead><tr><th>Department</th><th className="n">Licenses</th><th className="n">Active</th><th>Utilization</th><th className="n">Monthly cost</th><th className="n">Prompts / active</th></tr></thead>
            <tbody>
              {d.map((r) => (
                <tr key={r.name} className={`click ${sel === r.name ? "pick" : ""}`} onClick={() => onPick(sel === r.name ? null : r.name)}>
                  <td>{r.name}</td><td className="n">{num(r.licensed)}</td><td className="n">{num(r.active)}</td>
                  <td><span className={`bar ${r.utilization_pct < 50 ? "low" : ""}`}><i style={{ width: `${r.utilization_pct}%` }} /></span>{r.utilization_pct}%</td>
                  <td className="n">{usd(r.monthly_cost)}</td><td className="n">{r.prompts_per_active}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function AdoptionDepth() {
  const st = useApi("departments");
  return (
    <Panel title="Adoption vs depth" note="Each bubble is a department; size is headcount. Dashed lines are company averages." state={st}>
      {(d) => {
        const lic = d.reduce((a, r) => a + r.licensed, 0);
        const act = d.reduce((a, r) => a + r.active, 0);
        const pr = d.reduce((a, r) => a + Number(r.prompts), 0);
        const avgU = lic ? (100 * act) / lic : 0, avgP = act ? pr / act : 0;
        return (
          <>
            <ResponsiveContainer width="100%" height={270}>
              <ScatterChart margin={{ left: 4, right: 16, top: 8, bottom: 20 }}>
                <CartesianGrid stroke="#e6e9ee" />
                <XAxis type="number" dataKey="utilization_pct" domain={[0, 100]} unit="%"
                  label={{ value: "Adoption: share of licenses active", position: "insideBottom", offset: -10 }} />
                <YAxis type="number" dataKey="prompts_per_active"
                  label={{ value: "Prompts per active user", angle: -90, position: "insideLeft", offset: 8, style: { textAnchor: "middle" } }} />
                <ZAxis type="number" dataKey="licensed" range={[80, 700]} />
                <ReferenceLine x={avgU} stroke="#9aa5b4" strokeDasharray="4 4" />
                <ReferenceLine y={avgP} stroke="#9aa5b4" strokeDasharray="4 4" />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
                  const p = payload?.[0]?.payload; if (!p) return null;
                  return <div className="panel" style={{ padding: 8 }}><b>{p.name}</b><br />{p.utilization_pct}% adoption<br />{p.prompts_per_active} prompts per active user<br />{p.licensed} licenses</div>;
                }} />
                <Scatter data={d} fill={USED} fillOpacity={0.6} />
              </ScatterChart>
            </ResponsiveContainer>
            <p className="note" style={{ margin: 0 }}>Right and high: wide and deep. Right and low: wide but shallow. Left and high: few users, heavy use. Left and low: needs attention.</p>
          </>
        );
      }}
    </Panel>
  );
}

function Heatmap() {
  const st = useApi("heatmap");
  return (
    <Panel title="Department by app" note="Share of licensed users active in each app over 28 days." state={st}>
      {(d) => (
        <div className="scroll">
          <table className="heat">
            <thead><tr><th>Department</th>{APPS.map(([, l]) => <th key={l} style={{ textAlign: "center" }}>{l}</th>)}</tr></thead>
            <tbody>
              {d.map((r) => (
                <tr key={r.department}><td>{r.department}</td>
                  {APPS.map(([k]) => {
                    const v = Number(r[k] ?? 0);
                    return <td key={k} style={{ background: `rgba(47,76,221,${0.05 + v / 110})`, color: v > 50 ? "#fff" : "inherit" }}>{v}%</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Segments({ scope }) {
  const st = useApi("segments", scope);
  const order = ["Power", "Regular", "Light", "Lapsed", "Never used"];
  return (
    <Panel title="User segments" note="Power = 3+ apps in 28 days. Lapsed = no activity for 28+ days." state={st}>
      {(raw) => {
        const d = order.map((s) => raw.find((r) => r.segment === s) || { segment: s, users: 0, monthly_cost: 0 });
        return (
          <div className="donut">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={d} dataKey="users" nameKey="segment" innerRadius={48} outerRadius={80} paddingAngle={2}>
                  {d.map((r) => <Cell key={r.segment} fill={SEG_COLORS[r.segment]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="legend">
              {d.map((r) => (
                <div key={r.segment}><span><i className="dot" style={{ background: SEG_COLORS[r.segment] }} />{r.segment}</span>
                  <span>{num(r.users)} users · {usd(r.monthly_cost)}</span></div>
              ))}
            </div>
          </div>
        );
      }}
    </Panel>
  );
}

const TABS = [["power", "Power users"], ["idle", "Reclaim list"], ["all", "All licenses"]];
const COLS = [
  ["user_name", "User"], ["department", "Department"], ["manager_name", "Manager"],
  ["apps_used", "Apps", true], ["prompts", "Prompts", true], ["last_active", "Last active"], ["status", "Status"],
];
const PAGE_SIZE = 15;

function Users({ scope }) {
  const [view, setView] = useState("power");
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => { const t = setTimeout(() => setQ(input.trim()), 300); return () => clearTimeout(t); }, [input]);
  useEffect(() => { setPage(1); }, [view, q, sort, scope.dept]);

  const st = useApi("users", { ...scope, view, q, sort: sort?.key, dir: sort?.dir, page, page_size: PAGE_SIZE });
  const total = st.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(page * PAGE_SIZE, total);

  // click cycles ascending, descending, then back to the default order
  const clickSort = (key) => setSort((s) => (!s || s.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));

  return (
    <section className="panel">
      <div className="utop">
        <div><h2>Users</h2><p className="note" style={{ margin: 0 }}>
          {view === "power" ? "Active users, most apps and prompts first." : view === "idle" ? "Licensed users with no activity in 28+ days, longest idle first." : "Every assigned license and its monthly cost."}
          {" "}Click a column heading to sort.</p></div>
        <div className="tools">
          <input type="search" className="search" placeholder="Search name, email, manager, department" aria-label="Search users"
            value={input} onChange={(e) => setInput(e.target.value)} />
          <div className="seg">{TABS.map(([k, l]) => <button key={k} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}</div>
        </div>
      </div>
      {st.error ? <div className="msg err">Could not load: {st.error}</div> : !st.data ? <div className="msg">Loading…</div>
        : !st.data.rows.length ? <div className="msg">{q ? `No users match “${q}”.` : "No users match this view."}</div> : (
        <div className="scroll">
          <table>
            <thead><tr>
              {COLS.map(([key, label, numeric]) => (
                <th key={key} className={numeric ? "n" : ""} aria-sort={sort?.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                  <button className="sortbtn" onClick={() => clickSort(key)}>
                    {label}<span className="arrow">{sort?.key === key ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
                  </button>
                </th>
              ))}
              <th className="n">Cost / month</th>
            </tr></thead>
            <tbody>
              {st.data.rows.map((u) => (
                <tr key={u.user_principal_name}>
                  <td>{u.user_name}</td><td>{u.department}</td><td>{u.manager_name || "–"}</td>
                  <td className="n">{u.apps_used}</td><td className="n">{num(u.prompts)}</td>
                  <td>{u.last_active ? `${u.last_active} (${u.days_since}d ago)` : "Never"}</td>
                  <td><span className={`tag ${u.status.split(" ")[0]}`}>{u.status}</span></td>
                  <td className="n">{usd(u.monthly_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="pager">
        <span>{total ? `Showing ${from}–${to} of ${num(total)}` : ""}</span>
        <div>
          <button disabled={page <= 1} onClick={() => setPage(1)} aria-label="First page">«</button>
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="pg">Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
          <button disabled={page >= pages} onClick={() => setPage(pages)} aria-label="Last page">»</button>
        </div>
      </div>
    </section>
  );
}

function AsOf({ meta }) {
  if (!meta?.usage_date) return <div className="sub">Loading data date…</div>;
  const d = new Date(`${meta.usage_date}T00:00:00`);
  const age = Math.floor((Date.now() - d.getTime()) / 86400000);
  const label = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return (
    <div className={`asof ${age > 4 ? "stale" : ""}`}>
      <b>Data as of {label}</b>
      <span>{age > 4 ? `${age} days old. Check that the data refresh is running.` : "Microsoft usage reports run about 2 days behind."} {usd(meta.seat_price)} per seat per month.</span>
    </div>
  );
}

export default function App() {
  const [sel, setSel] = useState(null);
  const scope = sel ? { dept: sel } : {};
  const meta = useApi("meta");
  return (
    <div className="page">
      <header>
        <div>
          <h1>Copilot usage and spend</h1>
          <AsOf meta={meta.data} />
        </div>
        <div className="controls">
          {sel && <button className="chip" onClick={() => setSel(null)}>Filtered: {sel} ✕</button>}
        </div>
      </header>

      <Kpis scope={scope} />
      <div className="row r2"><Trend /><DeptUsage asOf={meta.data?.usage_date} /></div>
      <div className="row r-wide"><DeptTable sel={sel} onPick={setSel} /><AdoptionDepth /></div>
      <div className="row r-wide"><Heatmap /><Segments scope={scope} /></div>
      <Users scope={scope} />
    </div>
  );
}
