# Copilot Usage Dashboard

A one-page dashboard for Microsoft 365 Copilot adoption and licence cost, built from data already stored in PostgreSQL (Microsoft Graph usage reports joined to your employee table).

**Stack:** React (Vite + Recharts) · FastAPI · PostgreSQL

**What it shows:** KPI cards, weekly/monthly active-user trend, active vs licensed users by department, a department table (click a row to filter the page), adoption vs depth chart, department × app heatmap, user segments, and a searchable, sortable, paged user table (power users, reclaim list, all licences).

---

## 1. Project layout

```
copilot-dashboard/
├── .env.example          # copy to .env
├── .gitignore
├── README.md
├── backend/
│   ├── main.py           # FastAPI app (all endpoints)
│   ├── requirements.txt
│   ├── schema.sql        # reference tables + the v_user_latest view
│   └── seed.sql          # fake data for trying the app
└── frontend/
    ├── package.json
    ├── vite.config.js    # dev proxy: /api -> http://localhost:8000
    └── src/ (main.jsx, App.jsx, styles.css)
```

## 2. Prerequisites

- Python 3.10 or newer
- Node.js 18 or newer
- PostgreSQL with your Copilot usage and employee tables (or use `seed.sql` for fake data)

## 3. Database

The API reads four tables and one view.

| Object | Purpose |
|---|---|
| `copilot_user_usage` | One row per user per refresh (Graph `copilotUserUsage`). Keep appending; the newest `report_refresh_date` is used. |
| `employee` | Department, manager, name. Joined on `email = user_principal_name` (case-insensitive). |
| `copilot_user_count_summary` | Tenant totals per product (`any_app`, `chat`, `teams`, ...). Used for the "seats in tenant summary" figure. |
| `copilot_user_count_trend` | Daily tenant totals (`product = 'any_app'`). Feeds the trend chart. |
| `v_user_latest` (view) | One row per licensed user from the latest snapshot, with activity flags, status and segment. **All column mapping lives here.** |

If your column names differ from `schema.sql`, edit the `v_user_latest` view only. The API expects the view to expose:

`refresh_date, user_principal_name, user_name, department, manager_name, prompts_work, prompts_web, prompts, last_active, days_since, apps_used, status, segment, chat_active, teams_active, word_active, excel_active, powerpoint_active, onenote_active`

Create the view (and tables, if missing):

```bash
psql -d YOUR_DB -f backend/schema.sql
```

To try the app with fake data, use a separate database. Do not seed your real one.

```bash
createdb copilot_test
psql -d copilot_test -f backend/schema.sql -f backend/seed.sql
```

## 4. Configuration

Copy `.env.example` to `.env` in the project root and edit it. The API also reads `backend/.env` if present. Variables already set in the shell take priority.

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `DATABASE_URL` | yes | none | PostgreSQL connection string, e.g. `postgresql://user:pass@localhost:5432/copilot` |
| `SEAT_PRICE` | no | `30` | Price of one Copilot seat per month (USD) |
| `SUMMARY_PERIOD` | no | `30` | `report_period` used when reading the summary table |

## 5. Run locally

**API** (terminal 1):

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Check it: http://localhost:8000/api/health should return `{"status":"ok"}`. Interactive API docs are at http://localhost:8000/docs.

**UI** (terminal 2):

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server forwards `/api` to port 8000, so no UI configuration is needed.

## 6. Production build

```bash
cd frontend && npm run build          # outputs frontend/dist
cd backend && uvicorn main:app --host 0.0.0.0 --port 8000
```

Serve `frontend/dist` with any web server (nginx, IIS, etc.) and route `/api/*` to the API on port 8000, so the UI and API share one origin.

Before exposing it beyond your machine:
- The API has **no authentication** and shows individual user names. Put it behind SSO or a VPN, or add auth.
- CORS currently allows all origins. Restrict `allow_origins` in `main.py`.

## 7. How the numbers are calculated

| Term | Definition |
|---|---|
| Licensed | Users in the latest snapshot of `copilot_user_usage` (`report_period = 30`, newest `report_refresh_date`) |
| Active | Any Copilot app activity within 28 days of the refresh date |
| Weekly active | Activity within 7 days of the refresh date |
| Lapsed | Last activity more than 28 days ago |
| Never used | No activity date in any app |
| Utilization % | Active ÷ Licensed |
| Monthly cost | Licensed × `SEAT_PRICE` |
| Segments | Power: 3+ apps active in 28 days. Regular: 2 apps. Light: 1 app. Lapsed and Never used as above. |
| Trend | The last reported day of each week or month from `copilot_user_count_trend` (`any_app`). Values are rolling-window counts from Microsoft, so end-of-period is used, not a sum of days. |

The "Data as of" banner shows the newest `report_refresh_date`. Microsoft reports run about 2 days behind, and the banner turns amber if the data is more than 4 days old.

## 8. API reference

All endpoints are `GET` and return JSON. Base URL: `http://localhost:8000`.

| Endpoint | Parameters | Returns |
|---|---|---|
| `/api/health` | none | `{"status":"ok"}`; errors if the database is unreachable |
| `/api/meta` | none | `usage_date`, `trend_date`, `summary_date`, `seat_price` |
| `/api/kpis` | `dept` (optional) | `licensed, active, wau, mau, idle, lapsed, never, utilization_pct, monthly_spend, prompts, prompts_work, prompts_web, avg_prompts_per_active, purchased_seats, seat_price, refresh_date` |
| `/api/trend` | `grain` = `week` (default) or `month`; `periods` = 2 to 36 (default 12) | `{as_of, grain, rows[]}`; each row has `period_start, last_day, enabled, active, utilization_pct, partial` |
| `/api/departments` | `min_size` (default 1) | Array of `name, licensed, active, prompts, utilization_pct, monthly_cost, prompts_per_active`, lowest utilization first |
| `/api/heatmap` | `min_size` (default 1) | Array of `department, users, chat, teams, word, excel, powerpoint, onenote` (percent active in each app) |
| `/api/segments` | `dept` (optional) | Array of `segment, users, monthly_cost` |
| `/api/users` | `view` = `power` (default), `idle`, `all`; `dept`; `q` (search name, email, manager, department); `sort` = `user_name, department, manager_name, apps_used, prompts, last_active, status`; `dir` = `asc` or `desc`; `page` (default 1); `page_size` (1 to 100, default 15) | `{total, page, page_size, rows[]}`; each row has `user_name, user_principal_name, department, manager_name, apps_used, prompts, prompts_work, prompts_web, last_active, days_since, status, monthly_cost` |

Examples:

```
/api/kpis?dept=Sales
/api/trend?grain=month&periods=6
/api/users?view=idle&q=smith&sort=last_active&dir=desc&page=2
```

## 9. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Cards show "Could not load" | API not running, or it returned an error. Check the uvicorn terminal. |
| `relation "v_user_latest" does not exist` | Run `schema.sql` (or your own version of the view) on the right database. |
| `column ... does not exist` | A column in the view does not match your table. Edit the view. |
| Pool or connection error at startup | `DATABASE_URL` is missing or wrong. Check `.env` is in the project root, and test `/api/health`. |
| Trend chart empty | `copilot_user_count_trend` has no rows with `product = 'any_app'`. |
| Licensed count differs from "seats in tenant summary" | The user report may include removed users or miss unused seats. Reconcile against Graph licence assignments. |
| Data banner is amber | The newest `report_refresh_date` is more than 4 days old. Check the data fetch job. |
| Port 8000 or 5173 in use | Stop the other process, or change the port (`--port`, and the proxy target in `vite.config.js`). |

## 10. Push to Git

Check first:
- `.env` is listed in `.gitignore` (it is) and does not appear in `git status`. Only `.env.example` should be committed.
- No passwords or real user data in any file.

```bash
cd copilot-dashboard
git init
git add .
git status                      # confirm .env, node_modules and *.zip are NOT listed
git commit -m "Copilot usage dashboard: FastAPI, React, PostgreSQL"
git branch -M main
git remote add origin https://github.com/YOUR_ORG/YOUR_REPO.git
git push -u origin main
```

If `.env` was committed by mistake: `git rm --cached .env`, commit, and change the database password, since it stays in git history.

## 11. Not included yet

The scheduled fetch from Microsoft Graph into PostgreSQL, authentication, and Graph licence-assignment data.