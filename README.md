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

| Object                       | Purpose                                                                                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `copilot_user_usage`         | One row per user per refresh (Graph `copilotUserUsage`). Keep appending; the newest `report_refresh_date` is used.                                                                  |
| `employee`                   | Department, manager, name. Joined on `email = user_principal_name` (case-insensitive).                                                                                              |
| `copilot_user_count_summary` | Tenant totals, one row per refresh and period, one column per metric (same shape as the Graph CSV). Used for the "seats in tenant summary" figure and the Active users cross-check. |
| `copilot_user_count_trend`   | Daily tenant totals, one row per day, one column per metric (same shape as the Graph response). Feeds the trend chart.                                                              |
| `v_user_latest` (view)       | One row per licensed user from the latest snapshot, with activity flags, status and segment. **All column mapping lives here.**                                                     |

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

### Summary and trend tables: the Graph response format

Both tables follow the CSV responses of the two Microsoft Graph reports exactly, with one column per metric.

```
GET https://graph.microsoft.com/v1.0/copilot/reports/getMicrosoft365CopilotUserCountSummary(period='D7')
GET https://graph.microsoft.com/v1.0/copilot/reports/getMicrosoft365CopilotUserCountTrend(period='D7')
```

Permission: `Reports.Read.All`. Beta versions live at `/beta/copilot/reports/...`.

**Summary CSV** (one row per refresh and period; the tenant-wide total):

```
Report Refresh Date,Report Period,Microsoft Teams Enabled Users,Microsoft Teams Active Users,Word Enabled Users,Word Active Users,PowerPoint Enabled Users,PowerPoint Active Users,Outlook Enabled Users,Outlook Active Users,Excel Enabled Users,Excel Active Users,OneNote Enabled Users,OneNote Active Users,Loop Enabled Users,Loop Active Users,Any App Enabled Users,Any App Active Users,Copilot Chat Enabled Users,Copilot Chat Active Users
2026-07-03,7,25,0,25,0,25,0,25,0,25,0,25,0,25,0,25,0,25,0
```

**Trend CSV** (one row per day; note that `Report Period` is the last column here, and second in the summary):

```
Report Refresh Date,Report Date,Microsoft Teams Enabled Users,Microsoft Teams Active Users,Word Enabled Users,Word Active Users,PowerPoint Enabled Users,PowerPoint Active Users,Outlook Enabled Users,Outlook Active Users,Excel Enabled Users,Excel Active Users,OneNote Enabled Users,OneNote Active Users,Loop Enabled Users,Loop Active Users,Any App Enabled Users,Any App Active Users,Copilot Chat Enabled Users,Copilot Chat Active Users,Report Period
2026-07-03,2026-07-03,25,0,25,0,25,0,25,0,25,0,25,0,25,0,25,0,25,0,7
```

**Table design** (`backend/schema.sql`). Column names are the CSV headers in snake_case: `Microsoft Teams Enabled Users` becomes `microsoft_teams_enabled_users`, `PowerPoint` becomes `powerpoint`, `OneNote` becomes `onenote`, `Any App` becomes `any_app`.

| Table                        | Key                                    | Notes                                                                                                                                                                                                                         |
| ---------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `copilot_user_count_summary` | `(report_refresh_date, report_period)` | 20 columns: dates, period, then enabled/active for Teams, Word, PowerPoint, Outlook, Excel, OneNote, Loop, Any App, Copilot Chat                                                                                              |
| `copilot_user_count_trend`   | `(report_period, report_date)`         | 21 columns: the same metrics plus `report_date`. The same date appears in D7, D30 and D90 pulls with different counts, so the period is part of the key. Upsert daily, so history builds up beyond the days one pull returns. |

**What the dashboard reads:**

- Summary: `any_app_enabled_users` (the "seats in tenant summary" figure) and `any_app_active_users` (the "Microsoft summary" cross-check on the Active users card), for `report_period = SUMMARY_PERIOD`, newest refresh.
- Trend: `report_date`, `any_app_enabled_users`, `any_app_active_users`, for `report_period = SUMMARY_PERIOD`.

**Loading the data.** One normaliser handles both the CSV headers and the JSON property names (the JSON form is nested under `value[].adoptionByDate[]`), by lower-casing and dropping non-alphanumerics:

```python
import re

def norm(x):
    return re.sub(r"[^a-z0-9]", "", x.lower())

def to_rows(records, columns):
    """records: dicts keyed by CSV header or JSON property. columns: the table's column names."""
    lookup = {norm(c): c for c in columns}      # 'powerpointactiveusers' -> 'powerpoint_active_users'
    return [{lookup[norm(k)]: v for k, v in rec.items() if norm(k) in lookup} for rec in records]
```

For the JSON trend response, flatten first: for each item in `value`, merge `reportRefreshDate` and `reportPeriod` into every entry of its `adoptionByDate` list.

**Report period and version.**

- Version 1 uses periods `D7`, `D30`, `D90`, `D180`, `ALL`; version 2 uses `D7`, `D28`, `D90`, `D180`, `ALL`. Pass `version` explicitly: Microsoft's reference page calls v2 the default, while an August 2026 blog post says v1 is.
- The period you pull must match `SUMMARY_PERIOD` and the `report_period = 30` in the `v_user_latest` view (30 for v1, 28 for v2).
- v2 adds Edge, Microsoft 365 Copilot, Copilot Chat (work/web) and Prompts submitted. Those columns are not in these tables yet; add them when you move to v2.

**Check your data.** Microsoft doesn't document whether a day's active count is that single day or a rolling window. Compare one `report_date` in the trend table with your user table. If they differ a lot, tell me and we will adjust the trend chart.

## 4. Configuration

Copy `.env.example` to `.env` in the project root and edit it. The API also reads `backend/.env` if present. Variables already set in the shell take priority.

| Variable         | Required | Default | Meaning                                                                                                                                                                                             |
| ---------------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`   | yes      | none    | PostgreSQL connection string, e.g. `postgresql://user:pass@localhost:5432/copilot`                                                                                                                  |
| `SEAT_PRICE`     | no       | `30`    | Price of one Copilot seat per month (USD)                                                                                                                                                           |
| `SUMMARY_PERIOD` | no       | `30`    | `report_period` read from the summary and trend tables and shown in `/api/meta`. Use `28` if you pull the v2 report. The `v_user_latest` view has its own `report_period = 30`; change it to match. |

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

| Term          | Definition                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Licensed      | Users in the latest snapshot of `copilot_user_usage` (`report_period = 30`, newest `report_refresh_date`)                                                                                                                                                                                                                                                                                                   |
| Active        | Any Copilot app activity within 28 days of the refresh date                                                                                                                                                                                                                                                                                                                                                 |
| Weekly active | Activity within 7 days of the refresh date                                                                                                                                                                                                                                                                                                                                                                  |
| Lapsed        | Last activity more than 28 days ago                                                                                                                                                                                                                                                                                                                                                                         |
| Never used    | No activity date in any app                                                                                                                                                                                                                                                                                                                                                                                 |
| Utilization % | Active ÷ Licensed                                                                                                                                                                                                                                                                                                                                                                                           |
| Monthly cost  | Licensed × `SEAT_PRICE`                                                                                                                                                                                                                                                                                                                                                                                     |
| Segments      | Power: 3+ apps active in 28 days. Regular: 2 apps. Light: 1 app. Lapsed and Never used as above.                                                                                                                                                                                                                                                                                                            |
| Trend         | The last reported day of each week or month from `copilot_user_count_trend` (`any_app_active_users` and `any_app_enabled_users`). Distinct users cannot be added across days, so the dashboard takes the end-of-period value, never a sum. Microsoft does not document whether each day is a single-day or rolling-window count, so compare one date against your user table (see the trend section above). |

The "Data as of" banner shows the newest `report_refresh_date`. Microsoft reports run about 2 days behind, and the banner turns amber if the data is more than 4 days old.

## 8. API reference

All endpoints are `GET` and return JSON. Base URL: `http://localhost:8000`.

| Endpoint           | Parameters                                                                                                                                                                                                                                                                 | Returns                                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/health`      | none                                                                                                                                                                                                                                                                       | `{"status":"ok"}`; errors if the database is unreachable                                                                                                                                                  |
| `/api/meta`        | none                                                                                                                                                                                                                                                                       | `usage_date`, `trend_date`, `summary_date`, `seat_price`                                                                                                                                                  |
| `/api/kpis`        | `dept` (optional)                                                                                                                                                                                                                                                          | `licensed, active, wau, mau, idle, lapsed, never, utilization_pct, monthly_spend, prompts, prompts_work, prompts_web, avg_prompts_per_active, purchased_seats, seat_price, refresh_date`                  |
| `/api/trend`       | `grain` = `week` (default) or `month`; `periods` = 2 to 36 (default 12)                                                                                                                                                                                                    | `{as_of, grain, rows[]}`; each row has `period_start, last_day, enabled, active, utilization_pct, partial`                                                                                                |
| `/api/departments` | `min_size` (default 1)                                                                                                                                                                                                                                                     | Array of `name, licensed, active, prompts, utilization_pct, monthly_cost, prompts_per_active`, lowest utilization first                                                                                   |
| `/api/heatmap`     | `min_size` (default 1)                                                                                                                                                                                                                                                     | Array of `department, users, chat, teams, word, excel, powerpoint, onenote` (percent active in each app)                                                                                                  |
| `/api/segments`    | `dept` (optional)                                                                                                                                                                                                                                                          | Array of `segment, users, monthly_cost`                                                                                                                                                                   |
| `/api/users`       | `view` = `power` (default), `idle`, `all`; `dept`; `q` (search name, email, manager, department); `sort` = `user_name, department, manager_name, apps_used, prompts, last_active, status`; `dir` = `asc` or `desc`; `page` (default 1); `page_size` (1 to 100, default 15) | `{total, page, page_size, rows[]}`; each row has `user_name, user_principal_name, department, manager_name, apps_used, prompts, prompts_work, prompts_web, last_active, days_since, status, monthly_cost` |

Examples:

```
/api/kpis?dept=Sales
/api/trend?grain=month&periods=6
/api/users?view=idle&q=smith&sort=last_active&dir=desc&page=2
```

## 9. Troubleshooting

| Symptom                                               | Likely cause and fix                                                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Cards show "Could not load"                           | API not running, or it returned an error. Check the uvicorn terminal.                                                 |
| `relation "v_user_latest" does not exist`             | Run `schema.sql` (or your own version of the view) on the right database.                                             |
| `column ... does not exist`                           | A column in the view does not match your table. Edit the view.                                                        |
| Pool or connection error at startup                   | `DATABASE_URL` is missing or wrong. Check `.env` is in the project root, and test `/api/health`.                      |
| Trend chart empty                                     | `copilot_user_count_trend` has no rows for `report_period = SUMMARY_PERIOD`. Check the period (30 for v1, 28 for v2). |
| Licensed count differs from "seats in tenant summary" | The user report may include removed users or miss unused seats. Reconcile against Graph licence assignments.          |
| Data banner is amber                                  | The newest `report_refresh_date` is more than 4 days old. Check the data fetch job.                                   |
| Port 8000 or 5173 in use                              | Stop the other process, or change the port (`--port`, and the proxy target in `vite.config.js`).                      |

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
