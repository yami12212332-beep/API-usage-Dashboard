# Copilot usage dashboard

FastAPI + PostgreSQL + React (Vite, Recharts). One page: KPIs, weekly/monthly active-user trend, active vs licensed users by department, department table, adoption-vs-depth chart, department × app heatmap, user segments, and a searchable, sortable, paged user table (power users, reclaim list, all licenses). Clicking a department row filters the KPIs, segments and user table.

## Run

```bash
createdb copilot_test
psql -d copilot_test -f backend/schema.sql -f backend/seed.sql   # fake data; skip seed.sql with real data

cd backend && pip install -r requirements.txt
DATABASE_URL=postgresql://user:pass@localhost:5432/copilot_test SEAT_PRICE=30 uvicorn main:app --reload

cd frontend && npm install && npm run dev      # http://localhost:5173
```

## Notes

- Column mapping lives in the `v_user_latest` view in `backend/schema.sql`. If your column names differ, edit the view only.
- The API reads these view columns: `refresh_date, user_name, user_principal_name, department, manager_name, prompts_work, prompts_web, prompts, last_active, days_since, apps_used, status, segment` and the `*_active` flags.
- `SEAT_PRICE` and `SUMMARY_PERIOD` are environment variables.

## API

`/api/meta` `/api/kpis` `/api/trend?grain=week|month` `/api/departments` `/api/heatmap` `/api/segments` `/api/users`
`/api/users` params: `view=power|idle|all`, `dept`, `q` (search), `sort`, `dir=asc|desc`, `page`, `page_size`.
