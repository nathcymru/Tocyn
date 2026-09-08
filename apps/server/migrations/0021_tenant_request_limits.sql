CREATE TABLE tenant_request_limits (
  tenant_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (tenant_id, bucket)
);
