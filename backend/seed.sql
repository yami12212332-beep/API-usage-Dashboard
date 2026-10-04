-- Fake data for trying the dashboard: psql -d copilot -f schema.sql -f seed.sql
CREATE FUNCTION pg_temp.rd(p float) RETURNS date LANGUAGE sql VOLATILE AS
$$ SELECT CASE WHEN random() < p THEN CURRENT_DATE - (random()*45)::int END $$;

INSERT INTO employee
SELECT i, 'User '||i, 'user'||i||'@corp.com',
  (ARRAY['Engineering','Sales','Finance','HR','Marketing','Support'])[1+i%6],
  'Analyst','Active','Full-time','Manager '||(1+i%8), 1+i%8, 'Member'
FROM generate_series(1,300) i;

INSERT INTO copilot_user_usage
SELECT CURRENT_DATE, 30, 'user'||i||'@corp.com', 'User '||i, NULL,
  pg_temp.rd(f), pg_temp.rd(f*.7), pg_temp.rd(f*.6), pg_temp.rd(f*.4), pg_temp.rd(f*.3), pg_temp.rd(f*.2),
  (random()*f*250)::int, (random()*f*120)::int
FROM (SELECT i, power(random(),.6) f FROM generate_series(1,280) i) t;

-- Summary: one row for the latest refresh (D30). Same numbers as the user rows above, roughly.
INSERT INTO copilot_user_count_summary (report_refresh_date, report_period,
  microsoft_teams_enabled_users, microsoft_teams_active_users, word_enabled_users, word_active_users,
  powerpoint_enabled_users, powerpoint_active_users, outlook_enabled_users, outlook_active_users,
  excel_enabled_users, excel_active_users, onenote_enabled_users, onenote_active_users,
  loop_enabled_users, loop_active_users, any_app_enabled_users, any_app_active_users,
  copilot_chat_enabled_users, copilot_chat_active_users)
VALUES (CURRENT_DATE, 30, 280, 112, 280, 84, 280, 42, 280, 126, 280, 56, 280, 22, 280, 14, 280, 174, 280, 154);

-- Trend: 90 days of daily pulls (D30 report); each row's refresh date is the day it was pulled.
INSERT INTO copilot_user_count_trend (report_refresh_date, report_date,
  microsoft_teams_enabled_users, microsoft_teams_active_users, word_enabled_users, word_active_users,
  powerpoint_enabled_users, powerpoint_active_users, outlook_enabled_users, outlook_active_users,
  excel_enabled_users, excel_active_users, onenote_enabled_users, onenote_active_users,
  loop_enabled_users, loop_active_users, any_app_enabled_users, any_app_active_users,
  copilot_chat_enabled_users, copilot_chat_active_users, report_period)
SELECT d::date, d::date,
  280, (a*.7)::int, 280, (a*.5)::int, 280, (a*.25)::int, 280, (a*.45)::int,
  280, (a*.3)::int, 280, (a*.1)::int, 280, (a*.05)::int, 280, a, 280, (a*.8)::int, 30
FROM (SELECT d, (280*(0.25+0.4*(d::date-(CURRENT_DATE-90))/90.0))::int AS a
      FROM generate_series(CURRENT_DATE-90, CURRENT_DATE, '1 day') d) t;