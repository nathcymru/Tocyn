-- Dynamic admission for dashboard SLA reads needs a bounded metadata row before
-- it can reserve the complete pause history. This monotonic upper bound is
-- deliberately not decremented: historical deletion may over-reserve later
-- reads, but it never makes a live history exceed its admitted population.
CREATE TABLE dashboard_sla_pause_read_counters (
  tenant_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  pause_rows_upper_bound INTEGER NOT NULL CHECK (pause_rows_upper_bound >= 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  PRIMARY KEY (tenant_id,ticket_id)
);

INSERT INTO dashboard_sla_pause_read_counters
  (tenant_id,ticket_id,pause_rows_upper_bound,revision)
SELECT tenant_id,ticket_id,COUNT(*),0
FROM ticket_sla_pause_intervals
GROUP BY tenant_id,ticket_id;

CREATE TRIGGER dashboard_sla_pause_read_insert
AFTER INSERT ON ticket_sla_pause_intervals BEGIN
  INSERT INTO dashboard_sla_pause_read_counters
    (tenant_id,ticket_id,pause_rows_upper_bound,revision)
  VALUES (NEW.tenant_id,NEW.ticket_id,1,1)
  ON CONFLICT(tenant_id,ticket_id) DO UPDATE SET
    pause_rows_upper_bound=pause_rows_upper_bound+1,
    revision=revision+1;
END;

-- The product never moves a pause interval. Keep direct, tenant-scoped repairs
-- conservative without reducing the old ticket's upper bound.
CREATE TRIGGER dashboard_sla_pause_read_move
AFTER UPDATE OF tenant_id,ticket_id ON ticket_sla_pause_intervals
WHEN OLD.tenant_id<>NEW.tenant_id OR OLD.ticket_id<>NEW.ticket_id BEGIN
  INSERT INTO dashboard_sla_pause_read_counters
    (tenant_id,ticket_id,pause_rows_upper_bound,revision)
  VALUES (NEW.tenant_id,NEW.ticket_id,1,1)
  ON CONFLICT(tenant_id,ticket_id) DO UPDATE SET
    pause_rows_upper_bound=pause_rows_upper_bound+1,
    revision=revision+1;
END;
