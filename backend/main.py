"""Copilot usage dashboard API.  Run: uvicorn main:app --reload"""
import os
from datetime import timedelta
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from dotenv import load_dotenv
load_dotenv(dotenv_path=r"../.env")

DB_URL = os.getenv("DATABASE_URL")
SEAT_PRICE = float(os.getenv("SEAT_PRICE", "30"))
SUMMARY_PERIOD = int(os.getenv("SUMMARY_PERIOD", "30"))

pool = AsyncConnectionPool(DB_URL, open=False, kwargs={"row_factory": dict_row})


@asynccontextmanager
async def lifespan(_):
    await pool.open()
    yield
    await pool.close()


app = FastAPI(title="Copilot Usage Dashboard", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

SCOPE = "(%(dept)s::text IS NULL OR department = %(dept)s)"
SEARCH = ("(%(q)s::text IS NULL OR user_name ILIKE %(q)s OR user_principal_name ILIKE %(q)s "
          "OR manager_name ILIKE %(q)s OR department ILIKE %(q)s)")
USER_FILTERS = {"power": "status = 'Active'", "idle": "status <> 'Active'", "all": "TRUE"}
USER_DEFAULT_ORDER = {
    "power": "apps_used DESC, prompts DESC, user_name",
    "idle": "days_since DESC NULLS FIRST, user_name",
    "all": "user_name",
}
SORT_COLS = {"user_name", "department", "manager_name", "apps_used", "prompts", "last_active", "status"}


async def rows(sql, params=None):
    async with pool.connection() as conn:
        cur = await conn.execute(sql, params or {})
        return await cur.fetchall()


def ratio(a, b, digits=1):
    return round(100.0 * a / b, digits) if b else 0


@app.get("/api/meta")
async def meta():
    """Dates the data is current to (Microsoft reports lag about 2 days)."""
    r = (await rows("""
        SELECT (SELECT MAX(report_refresh_date) FROM copilot_user_usage WHERE report_period = 30) AS usage_date,
               (SELECT MAX(report_date) FROM copilot_user_count_trend
                 WHERE product = 'any_app' AND active_users IS NOT NULL) AS trend_date,
               (SELECT MAX(report_refresh_date) FROM copilot_user_count_summary
                 WHERE report_period = %s) AS summary_date""", (SUMMARY_PERIOD,)))[0]
    return {**r, "seat_price": SEAT_PRICE}


@app.get("/api/kpis")
async def kpis(dept: str | None = None):
    r = (await rows(f"""
        SELECT MAX(refresh_date) AS refresh_date, COUNT(*) AS licensed,
          COUNT(*) FILTER (WHERE status = 'Active') AS active,
          COUNT(*) FILTER (WHERE days_since <= 7) AS wau,
          COUNT(*) FILTER (WHERE status = 'Lapsed') AS lapsed,
          COUNT(*) FILTER (WHERE status = 'Never used') AS never,
          COALESCE(SUM(prompts_work), 0) AS prompts_work, COALESCE(SUM(prompts_web), 0) AS prompts_web
        FROM v_user_latest WHERE {SCOPE}""", {"dept": dept}))[0]
    purchased = await rows(
        """SELECT enabled_users FROM copilot_user_count_summary
           WHERE product = 'any_app' AND report_period = %s
           ORDER BY report_refresh_date DESC LIMIT 1""", (SUMMARY_PERIOD,))
    lic, act = r["licensed"], r["active"]
    prompts = r["prompts_work"] + r["prompts_web"]
    return {
        **r, "seat_price": SEAT_PRICE,
        "purchased_seats": purchased[0]["enabled_users"] if purchased else None,
        "idle": lic - act, "mau": act,
        "utilization_pct": ratio(act, lic),
        "monthly_spend": lic * SEAT_PRICE,
        "prompts": prompts,
        "avg_prompts_per_active": round(prompts / act, 1) if act else 0,
    }


@app.get("/api/trend")
async def trend(grain: str = "week", periods: int = Query(12, ge=2, le=36)):
    """Weekly or monthly summary of the tenant trend: the last reported day of each period.
    Anchored to the newest date in the table, not today's date, so lagging data is never dropped."""
    grain = grain if grain in ("week", "month") else "week"
    as_of = (await rows("""SELECT MAX(report_date) AS d FROM copilot_user_count_trend
                           WHERE product = 'any_app' AND active_users IS NOT NULL"""))[0]["d"]
    if as_of is None:
        return {"as_of": None, "grain": grain, "rows": []}
    data = await rows(f"""
        SELECT * FROM (
          SELECT DISTINCT ON (date_trunc('{grain}', report_date))
                 date_trunc('{grain}', report_date)::date AS period_start,
                 report_date AS last_day, enabled_users AS enabled, active_users AS active
          FROM copilot_user_count_trend
          WHERE product = 'any_app' AND active_users IS NOT NULL
          ORDER BY date_trunc('{grain}', report_date), report_date DESC
        ) t ORDER BY period_start DESC LIMIT %s""", (periods,))
    data.reverse()
    for d in data:
        d["utilization_pct"] = ratio(d["active"], d["enabled"])
        d["partial"] = False
    last = data[-1]
    start = last["period_start"]
    end = (start + timedelta(days=6) if grain == "week"
           else (start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1))
    last["partial"] = last["last_day"] < end
    return {"as_of": as_of, "grain": grain, "rows": data}


@app.get("/api/departments")
async def departments(min_size: int = 1):
    data = await rows("""
        SELECT department AS name, COUNT(*) AS licensed,
          COUNT(*) FILTER (WHERE status = 'Active') AS active,
          COALESCE(SUM(prompts), 0) AS prompts
        FROM v_user_latest GROUP BY department HAVING COUNT(*) >= %s""", (min_size,))
    for d in data:
        d["utilization_pct"] = ratio(d["active"], d["licensed"])
        d["monthly_cost"] = d["licensed"] * SEAT_PRICE
        d["prompts_per_active"] = round(d["prompts"] / d["active"], 1) if d["active"] else 0
    return sorted(data, key=lambda d: d["utilization_pct"])


@app.get("/api/heatmap")
async def heatmap(min_size: int = 1):
    return await rows("""
        SELECT department, COUNT(*) AS users,
          ROUND(100.0 * AVG(chat_active::int), 0) AS chat,
          ROUND(100.0 * AVG(teams_active::int), 0) AS teams,
          ROUND(100.0 * AVG(word_active::int), 0) AS word,
          ROUND(100.0 * AVG(excel_active::int), 0) AS excel,
          ROUND(100.0 * AVG(powerpoint_active::int), 0) AS powerpoint,
          ROUND(100.0 * AVG(onenote_active::int), 0) AS onenote
        FROM v_user_latest GROUP BY department HAVING COUNT(*) >= %s
        ORDER BY department""", (min_size,))


@app.get("/api/segments")
async def segments(dept: str | None = None):
    data = await rows(
        f"SELECT segment, COUNT(*) AS users FROM v_user_latest WHERE {SCOPE} GROUP BY segment",
        {"dept": dept})
    for d in data:
        d["monthly_cost"] = d["users"] * SEAT_PRICE
    return data


@app.get("/api/users")
async def users(view: str = "power", dept: str | None = None, q: str | None = None,
                sort: str | None = None, direction: str = Query("asc", alias="dir"),
                page: int = Query(1, ge=1), page_size: int = Query(15, ge=1, le=100)):
    view = view if view in USER_FILTERS else "power"
    if sort in SORT_COLS:
        order = f"{sort} {'DESC' if direction == 'desc' else 'ASC'} NULLS LAST, user_name"
    else:
        order = USER_DEFAULT_ORDER[view]
    like = None
    if q:
        like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    where = f"{SCOPE} AND {USER_FILTERS[view]} AND {SEARCH}"
    params = {"dept": dept, "q": like, "limit": page_size, "offset": (page - 1) * page_size}
    total = (await rows(f"SELECT COUNT(*) AS n FROM v_user_latest WHERE {where}", params))[0]["n"]
    data = await rows(f"""
        SELECT user_name, user_principal_name, department, manager_name,
               apps_used, prompts, prompts_work, prompts_web, last_active, days_since, status
        FROM v_user_latest WHERE {where}
        ORDER BY {order} LIMIT %(limit)s OFFSET %(offset)s""", params)
    for d in data:
        d["monthly_cost"] = SEAT_PRICE
    return {"total": total, "page": page, "page_size": page_size, "rows": data}