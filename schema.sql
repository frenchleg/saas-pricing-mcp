-- D1 schema for usage logging. Apply with:
--   npx wrangler d1 execute saas-pricing-mcp --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  tool TEXT NOT NULL,
  products_requested TEXT,
  products_missing TEXT,
  args TEXT,
  ok INTEGER,
  ms INTEGER,
  user_agent TEXT,
  country TEXT
);
CREATE INDEX IF NOT EXISTS calls_ts ON calls (ts);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  client_name TEXT,
  client_version TEXT,
  user_agent TEXT,
  country TEXT
);
CREATE INDEX IF NOT EXISTS sessions_ts ON sessions (ts);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  product TEXT,
  plan TEXT,
  details TEXT,
  suggested_price TEXT,
  user_agent TEXT
);

-- Failed MCP requests (also created automatically by the Worker on the first failure)
CREATE TABLE IF NOT EXISTS errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  method TEXT,
  status INTEGER,
  message TEXT,
  rpc_method TEXT,
  protocol_version TEXT,
  user_agent TEXT,
  country TEXT
);
CREATE INDEX IF NOT EXISTS errors_ts ON errors (ts);

-- Live traffic: one row per minute (UTC), counting every request except test traffic and the
-- dashboard's own /stats requests. Numbers only, no personal data. Created lazily too.
CREATE TABLE IF NOT EXISTS traffic (
  minute TEXT PRIMARY KEY,          -- 'YYYY-MM-DDTHH:MM'
  requests INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0, -- responses with status >= 400
  mcp INTEGER NOT NULL DEFAULT 0     -- requests to /mcp
);
CREATE INDEX IF NOT EXISTS traffic_requests ON traffic (requests);
