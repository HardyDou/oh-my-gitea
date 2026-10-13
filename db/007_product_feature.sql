CREATE TABLE IF NOT EXISTS product_release (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ongoing', 'released', 'archived')),
  target_date DATE,
  released_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_release_product_idx ON product_release(product_id);

CREATE TABLE IF NOT EXISTS product_feature (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  release_id BIGINT REFERENCES product_release(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'designing', 'developing', 'released', 'deferred')),
  priority TEXT NOT NULL DEFAULT 'P2' CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
  assignee TEXT,
  created_by BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_feature_product_idx ON product_feature(product_id);
CREATE INDEX IF NOT EXISTS product_feature_release_idx ON product_feature(release_id);

CREATE TABLE IF NOT EXISTS feature_issue (
  id BIGSERIAL PRIMARY KEY,
  feature_id BIGINT NOT NULL REFERENCES product_feature(id) ON DELETE CASCADE,
  repository_id BIGINT NOT NULL REFERENCES repository(id) ON DELETE CASCADE,
  issue_number INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'open',
  added_by BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (feature_id, repository_id, issue_number)
);
