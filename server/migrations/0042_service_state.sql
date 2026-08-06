-- Service closedown switch (beta -> full release window).
--
-- Deliberately a D1 row rather than a Worker var: the local admin console's
-- Cloudflare token is scoped to D1 read/write only, so it can flip this without a
-- Workers-scoped token or a redeploy. MUTATIONS_DISABLED remains the incident lever
-- that needs a deploy; this is the planned-closedown lever that does not.
--
-- Single row, enforced by the CHECK. Modes:
--   open           normal service
--   signups_closed existing accounts play as usual; no new accounts
--   export_only    existing accounts sign in and load READ-ONLY so they can move
--                  their farm to Local Farm; every gameplay mutation is refused
--   closed         no sign-in at all
CREATE TABLE IF NOT EXISTS service_state (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  mode       TEXT    NOT NULL DEFAULT 'open'
               CHECK (mode IN ('open','signups_closed','export_only','closed')),
  notice     TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO service_state (id, mode, notice, updated_at) VALUES (1, 'open', NULL, 0);
