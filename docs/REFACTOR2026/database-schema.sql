-- ==================== 生成历史表 ====================
CREATE TABLE IF NOT EXISTS history (
  -- 主键
  id TEXT PRIMARY KEY,

  -- 模型信息
  provider_id TEXT NOT NULL,          -- 'ppio', 'fal', 'kie', 'modelscope'
  model_id TEXT NOT NULL,             -- 'wan-2.6', 'kling-v2.6', etc.
  type TEXT NOT NULL,                 -- 'image', 'video', 'audio'

  -- 生成参数
  prompt TEXT,                        -- 提示词
  params TEXT,                        -- JSON 格式的完整参数

  -- 结果（只存储文件路径，不存储 base64/url）
  file_path TEXT,                     -- 本地文件路径（相对于 AppLocalData）
  task_id TEXT,                       -- API 任务 ID（用于追踪）

  -- 状态
  status TEXT NOT NULL DEFAULT 'completed',  -- 'completed', 'failed', 'timeout'
  error_message TEXT,                 -- 错误信息（如果失败）

  -- 元数据
  cost REAL,                          -- 生成成本（元）
  duration INTEGER,                   -- 生成耗时（秒）

  -- 时间戳
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- 约束
  CHECK (type IN ('image', 'video', 'audio')),
  CHECK (status IN ('completed', 'failed', 'timeout'))
);

-- 索引：按时间倒序查询（最常用）
CREATE INDEX IF NOT EXISTS idx_history_created_at
  ON history(created_at DESC);

-- 索引：按模型查询
CREATE INDEX IF NOT EXISTS idx_history_model
  ON history(provider_id, model_id);

-- 索引：按类型查询
CREATE INDEX IF NOT EXISTS idx_history_type
  ON history(type, created_at DESC);

-- 全文搜索索引（用于提示词搜索）
CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(
  id UNINDEXED,
  prompt,
  content=history,
  content_rowid=rowid
);

-- 触发器：自动更新 updated_at
CREATE TRIGGER IF NOT EXISTS update_history_timestamp
  AFTER UPDATE ON history
BEGIN
  UPDATE history SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- 触发器：同步全文搜索索引（插入）
CREATE TRIGGER IF NOT EXISTS history_fts_insert
  AFTER INSERT ON history
BEGIN
  INSERT INTO history_fts(rowid, id, prompt)
  VALUES (NEW.rowid, NEW.id, NEW.prompt);
END;

-- 触发器：同步全文搜索索引（更新）
CREATE TRIGGER IF NOT EXISTS history_fts_update
  AFTER UPDATE ON history
BEGIN
  UPDATE history_fts SET prompt = NEW.prompt WHERE rowid = NEW.rowid;
END;

-- 触发器：同步全文搜索索引（删除）
CREATE TRIGGER IF NOT EXISTS history_fts_delete
  AFTER DELETE ON history
BEGIN
  DELETE FROM history_fts WHERE rowid = OLD.rowid;
END;

-- ==================== 预设表 ====================
CREATE TABLE IF NOT EXISTS presets (
  -- 主键
  id TEXT PRIMARY KEY,

  -- 预设信息
  name TEXT NOT NULL,                 -- 预设名称
  description TEXT,                   -- 预设描述

  -- 模型绑定（可选）
  model_id TEXT,                      -- 绑定的模型 ID（NULL 表示全局预设）

  -- 参数
  params TEXT NOT NULL,               -- JSON 格式的参数对象

  -- 元数据
  is_favorite INTEGER DEFAULT 0,     -- 是否收藏（0/1）
  use_count INTEGER DEFAULT 0,       -- 使用次数

  -- 时间戳
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  CHECK (is_favorite IN (0, 1))
);

-- 索引：按名称搜索
CREATE INDEX IF NOT EXISTS idx_presets_name
  ON presets(name);

-- 索引：按模型查询
CREATE INDEX IF NOT EXISTS idx_presets_model
  ON presets(model_id);

-- 索引：收藏优先 + 使用次数排序
CREATE INDEX IF NOT EXISTS idx_presets_favorite_usage
  ON presets(is_favorite DESC, use_count DESC, created_at DESC);

-- 触发器：自动更新 updated_at
CREATE TRIGGER IF NOT EXISTS update_presets_timestamp
  AFTER UPDATE ON presets
BEGIN
  UPDATE presets SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- ==================== 应用设置表 ====================
CREATE TABLE IF NOT EXISTS settings (
  -- 键值对
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,

  -- 元数据
  type TEXT DEFAULT 'string',         -- 'string', 'number', 'boolean', 'json'
  description TEXT,                   -- 设置说明

  -- 时间戳
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  CHECK (type IN ('string', 'number', 'boolean', 'json'))
);

-- 触发器：自动更新 updated_at
CREATE TRIGGER IF NOT EXISTS update_settings_timestamp
  AFTER UPDATE ON settings
BEGIN
  UPDATE settings SET updated_at = CURRENT_TIMESTAMP WHERE key = NEW.key;
END;

-- ==================== 自定义模型表（Phase 3 预留）====================
CREATE TABLE IF NOT EXISTS custom_models (
  -- 主键
  id TEXT PRIMARY KEY,

  -- 基础信息
  name TEXT NOT NULL,
  provider_id TEXT NOT NULL,          -- 'modelscope' 等
  base_model TEXT,                    -- 基础模型 ID

  -- 配置
  config TEXT NOT NULL,               -- JSON 格式的完整模型配置

  -- 元数据
  is_enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  CHECK (is_enabled IN (0, 1))
);

-- 触发器：自动更新 updated_at
CREATE TRIGGER IF NOT EXISTS update_custom_models_timestamp
  AFTER UPDATE ON custom_models
BEGIN
  UPDATE custom_models SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
