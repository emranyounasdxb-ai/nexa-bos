"""Forward-only SQL for ACTIVE scorecards that lack a required KPI baseline."""

from __future__ import annotations

DEACTIVATE_ACTIVE_MISSING_BASELINE_SQL = """
UPDATE kpi_scorecards AS card
SET status = 'inactive'
WHERE card.status = 'active'
  AND EXISTS (
    SELECT 1
    FROM kpi_scorecard_metrics AS metric
    WHERE metric.scorecard_id = card.id
      AND metric.baseline IS NULL
      AND metric.metric_code NOT IN (
        'submitted_count',
        'submitted_value',
        'approved_count',
        'approved_value',
        'booked_count',
        'booked_value',
        'funded_count',
        'funded_value'
      )
  )
"""
