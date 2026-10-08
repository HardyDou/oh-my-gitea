CREATE TABLE IF NOT EXISTS stage_config (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stage_substage_config (
  id BIGSERIAL PRIMARY KEY,
  stage_id BIGINT NOT NULL REFERENCES stage_config(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (stage_id, name)
);

ALTER TABLE issue_management DROP CONSTRAINT IF EXISTS issue_management_stage_check;
ALTER TABLE issue_management ADD COLUMN IF NOT EXISTS sub_stage TEXT NOT NULL DEFAULT '未开始';
ALTER TABLE issue_management ADD COLUMN IF NOT EXISTS stage_code TEXT;
ALTER TABLE issue_management ADD COLUMN IF NOT EXISTS sub_stage_code TEXT;
ALTER TABLE stage_substage_config ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE issue_flow_history ADD COLUMN IF NOT EXISTS from_sub_stage TEXT;
ALTER TABLE issue_flow_history ADD COLUMN IF NOT EXISTS to_sub_stage TEXT;
UPDATE issue_management SET stage = '归档' WHERE stage = '完成';
ALTER TABLE stage_config ADD COLUMN IF NOT EXISTS code TEXT;
UPDATE stage_config SET code = CASE name WHEN '需求' THEN 'requirement' WHEN '研发' THEN 'development' WHEN '测试' THEN 'testing' WHEN '完成' THEN 'archive' WHEN '归档' THEN 'archive' ELSE 'stage_' || id::text END WHERE code IS NULL;
ALTER TABLE stage_config ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stage_config_code_unique ON stage_config(code);
UPDATE issue_management SET stage_code = CASE stage WHEN '需求' THEN 'requirement' WHEN '研发' THEN 'development' WHEN '测试' THEN 'testing' WHEN '完成' THEN 'archive' WHEN '归档' THEN 'archive' ELSE stage END WHERE stage_code IS NULL;

INSERT INTO stage_config (code, name, sort_order) VALUES
  ('requirement', '需求', 10), ('development', '研发', 20), ('testing', '测试', 30), ('archive', '归档', 40)
ON CONFLICT (code) DO NOTHING;

UPDATE stage_substage_config SET code = CASE name WHEN '未开始' THEN 'not_started' WHEN '进行中' THEN 'in_progress' WHEN '完成' THEN 'completed' ELSE 'substage_' || id::text END WHERE code IS NULL;
ALTER TABLE stage_substage_config ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stage_substage_config_code_unique ON stage_substage_config(stage_id, code);

INSERT INTO stage_substage_config (stage_id, code, name, sort_order)
SELECT s.id, sub.code, sub.name, sub.sort_order
FROM stage_config s
CROSS JOIN (VALUES ('not_started', '未开始', 10), ('in_progress', '进行中', 20), ('completed', '完成', 30)) AS sub(code, name, sort_order)
WHERE s.name IN ('需求', '研发', '测试', '归档')
ON CONFLICT (stage_id, code) DO NOTHING;

UPDATE issue_management m SET sub_stage_code = s.code
FROM stage_substage_config s
WHERE m.stage_code = (SELECT sc.code FROM stage_config sc WHERE sc.id = s.stage_id)
  AND m.sub_stage = s.name
  AND m.sub_stage_code IS NULL;
