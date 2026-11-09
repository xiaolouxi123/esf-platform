-- AMXX 插件心跳：插件连库后 REPLACE INTO，用于客户端面板/运维判断
-- 每台游戏服 × 每个插件一行；updated_at 由 MySQL 自动维护。
CREATE TABLE IF NOT EXISTS amxx_builds (
  server_key VARCHAR(32) NOT NULL,
  plugin     VARCHAR(32) NOT NULL,
  build      VARCHAR(32) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (server_key, plugin),
  KEY idx_amxx_builds_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
