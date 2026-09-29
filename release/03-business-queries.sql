-- Fixtech Demo v1.8: five read-only business questions for course presentation.
-- Run on a disposable, seeded PostgreSQL Demo database after installing
-- release/FixTech-demo-v1.8.database.sql. Empty results are valid for empty data.
-- This script does not create, update, or delete rows.

-- Q1. How many jobs are in each state?
SELECT status, COUNT(*) AS job_count
FROM jobs
GROUP BY status
ORDER BY job_count DESC, status;

-- Q2. Which seeded districts have the most jobs? Include districts with zero jobs.
SELECT d.code AS district_code, d.name AS district_name,
       COUNT(j.id) AS job_count
FROM districts AS d
LEFT JOIN jobs AS j ON j.district_code = d.code
GROUP BY d.code, d.name
ORDER BY job_count DESC, d.code;

-- Q3. How many jobs have been assigned to each provider?
-- Assignment count is not a quality score or a live availability signal.
SELECT p.id AS provider_id, p.display_name,
       COUNT(j.id) AS assigned_job_count
FROM provider_profiles AS p
LEFT JOIN jobs AS j ON j.assigned_provider_id = p.id
GROUP BY p.id, p.display_name
ORDER BY assigned_job_count DESC, p.id;

-- Q4. What are the averages of recorded estimate snapshots by service type?
-- Historical records are included; do not present this as a live market rate.
SELECT category, service_format,
       COUNT(*) AS estimate_snapshot_count,
       ROUND(AVG(estimated_min), 2) AS avg_estimated_min_thb,
       ROUND(AVG(estimated_max), 2) AS avg_estimated_max_thb
FROM price_estimates
WHERE status IN ('ESTIMATED', 'ACCEPTED')
  AND estimated_min IS NOT NULL
  AND estimated_max IS NOT NULL
GROUP BY category, service_format
ORDER BY category, service_format;

-- Q5. How many disputes are recorded in each status?
SELECT status, COUNT(*) AS dispute_count,
       COUNT(DISTINCT job_id) AS distinct_jobs
FROM disputes
GROUP BY status
ORDER BY dispute_count DESC, status;
