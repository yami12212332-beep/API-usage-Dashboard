-- Reference schema. Rename columns here (or in the view) if your tables differ.
CREATE TABLE IF NOT EXISTS employee (
  employee_id int PRIMARY KEY, user_name text, email text, department text, position text,
  worker_status text, type text, manager_name text, manager_id int, member_type text);

CREATE TABLE IF NOT EXISTS copilot_user_usage (
  report_refresh_date date, report_period int, user_principal_name text, display_name text,
  last_activity_date date,
  copilot_chat_last_activity date, teams_last_activity date, word_last_activity date,
  excel_last_activity date, powerpoint_last_activity date, onenote_last_activity date,
  prompts_work int, prompts_web int,
  PRIMARY KEY (report_refresh_date, report_period, user_principal_name));

CREATE TABLE IF NOT EXISTS copilot_user_count_summary (
  report_refresh_date date, report_period int, product text, enabled_users int, active_users int,
  PRIMARY KEY (report_refresh_date, report_period, product));

CREATE TABLE IF NOT EXISTS copilot_user_count_trend (
  report_refresh_date date, report_date date, product text, enabled_users int, active_users int,
  PRIMARY KEY (report_date, product));

-- One row per licensed user from the latest snapshot. "Active" = any app used within 28 days of the refresh date.
CREATE OR REPLACE VIEW v_user_latest AS
WITH latest AS (
  SELECT * FROM copilot_user_usage
  WHERE report_period = 30
    AND report_refresh_date = (SELECT MAX(report_refresh_date) FROM copilot_user_usage WHERE report_period = 30)
), b AS (
  SELECT l.report_refresh_date AS refresh_date, l.user_principal_name,
    COALESCE(e.user_name, l.display_name, l.user_principal_name) AS user_name,
    COALESCE(e.department, 'Unknown') AS department,
    e.manager_name,
    COALESCE(l.prompts_work, 0) AS prompts_work, COALESCE(l.prompts_web, 0) AS prompts_web,
    GREATEST(l.copilot_chat_last_activity, l.teams_last_activity, l.word_last_activity,
             l.excel_last_activity, l.powerpoint_last_activity, l.onenote_last_activity) AS last_active,
    COALESCE(l.copilot_chat_last_activity >= l.report_refresh_date - 28, false) AS chat_active,
    COALESCE(l.teams_last_activity        >= l.report_refresh_date - 28, false) AS teams_active,
    COALESCE(l.word_last_activity         >= l.report_refresh_date - 28, false) AS word_active,
    COALESCE(l.excel_last_activity        >= l.report_refresh_date - 28, false) AS excel_active,
    COALESCE(l.powerpoint_last_activity   >= l.report_refresh_date - 28, false) AS powerpoint_active,
    COALESCE(l.onenote_last_activity      >= l.report_refresh_date - 28, false) AS onenote_active
  FROM latest l
  LEFT JOIN employee e ON LOWER(e.email) = LOWER(l.user_principal_name)
), c AS (
  SELECT b.*, (refresh_date - last_active) AS days_since,
    chat_active::int + teams_active::int + word_active::int + excel_active::int
      + powerpoint_active::int + onenote_active::int AS apps_used
  FROM b
)
SELECT c.*, prompts_work + prompts_web AS prompts,
  CASE WHEN last_active IS NULL THEN 'Never used'
       WHEN days_since > 28 THEN 'Lapsed' ELSE 'Active' END AS status,
  CASE WHEN last_active IS NULL THEN 'Never used'
       WHEN days_since > 28 THEN 'Lapsed'
       WHEN apps_used >= 3 THEN 'Power'
       WHEN apps_used <= 1 THEN 'Light' ELSE 'Regular' END AS segment
FROM c;
