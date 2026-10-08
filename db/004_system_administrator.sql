-- 仅保存加盐的 scrypt 密码哈希，首次在页面设置，无公共默认密码。
CREATE TABLE IF NOT EXISTS system_administrator (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
