ALTER TABLE app_user ADD COLUMN IF NOT EXISTS gitea_access_token TEXT;

CREATE TABLE IF NOT EXISTS api_access_token (
  id BIGSERIAL PRIMARY KEY,
  app_user_id BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS api_access_token_user_idx ON api_access_token(app_user_id) WHERE revoked_at IS NULL;
