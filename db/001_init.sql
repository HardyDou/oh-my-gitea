CREATE TABLE IF NOT EXISTS app_user (
  id BIGSERIAL PRIMARY KEY,
  gitea_user_id BIGINT NOT NULL UNIQUE,
  login TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repository (
  id BIGSERIAL PRIMARY KEY,
  gitea_id BIGINT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL UNIQUE,
  html_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gitea_project (
  id BIGSERIAL PRIMARY KEY,
  repository_id BIGINT NOT NULL REFERENCES repository(id) ON DELETE CASCADE,
  gitea_project_id BIGINT NOT NULL,
  title TEXT NOT NULL,
  status TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repository_id, gitea_project_id)
);

CREATE TABLE IF NOT EXISTS issue_project (
  id BIGSERIAL PRIMARY KEY,
  repository_id BIGINT NOT NULL REFERENCES repository(id) ON DELETE CASCADE,
  project_id BIGINT NOT NULL REFERENCES gitea_project(id) ON DELETE CASCADE,
  issue_number INTEGER NOT NULL,
  UNIQUE (project_id, issue_number)
);

CREATE TABLE IF NOT EXISTS issue_management (
  id BIGSERIAL PRIMARY KEY,
  repository_id BIGINT NOT NULL REFERENCES repository(id) ON DELETE CASCADE,
  issue_number INTEGER NOT NULL,
  stage TEXT NOT NULL DEFAULT '需求' CHECK (stage IN ('需求', '研发', '测试', '完成')),
  priority TEXT NOT NULL DEFAULT 'P2' CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repository_id, issue_number)
);

CREATE TABLE IF NOT EXISTS issue_flow_history (
  id BIGSERIAL PRIMARY KEY,
  issue_management_id BIGINT NOT NULL REFERENCES issue_management(id) ON DELETE CASCADE,
  actor_gitea_user_id BIGINT,
  from_stage TEXT,
  to_stage TEXT,
  from_priority TEXT,
  to_priority TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_event (
  id BIGSERIAL PRIMARY KEY,
  delivery_id TEXT UNIQUE,
  event_name TEXT NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_gitea_user_id BIGINT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent')),
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  request_id TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
