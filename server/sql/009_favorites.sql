-- =====================================================================
-- 玩家收藏的服务器：按账号保存，换设备后仍然存在
-- 只存 server_key；管理员改名/换地址后，收藏项自动显示最新信息
-- =====================================================================

USE esf_platform;

CREATE TABLE IF NOT EXISTS server_favorites (
  user_id    BIGINT UNSIGNED NOT NULL,
  server_key VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, server_key),
  KEY idx_favorite_server (server_key),
  CONSTRAINT fk_favorite_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_favorite_server FOREIGN KEY (server_key) REFERENCES servers(server_key) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='玩家收藏的服务器';
