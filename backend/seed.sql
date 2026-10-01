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

INSERT INTO copilot_user_count_summary
SELECT CURRENT_DATE, 30, p, 280, (280*s)::int
FROM (VALUES ('any_app',.62),('chat',.55),('teams',.4),('word',.3),('excel',.2),('powerpoint',.15),('onenote',.08)) v(p,s);

INSERT INTO copilot_user_count_trend
SELECT CURRENT_DATE, d::date, 'any_app', 280, (280*(0.25+0.4*(d::date-(CURRENT_DATE-90))/90.0))::int
FROM generate_series(CURRENT_DATE-90, CURRENT_DATE, '1 day') d;
