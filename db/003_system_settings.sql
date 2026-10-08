-- 敏感配置以 AES-256-GCM 密文保存；加密密钥派生自 SESSION_SECRET。
-- 后端启动时也会创建此表，兼容已有数据库。
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  encrypted_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
