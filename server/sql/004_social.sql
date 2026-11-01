-- =====================================================================
-- 社交：在线状态 + 大厅频道
-- =====================================================================

USE esf_platform;

-- 在线状态：客户端每 20 秒心跳一次，75 秒没心跳视为离线
CREATE TABLE IF NOT EXISTS presence (
  user_id    BIGINT UNSIGNED PRIMARY KEY,
  state      ENUM('lobby','ingame') NOT NULL DEFAULT 'lobby',
  server_key VARCHAR(32) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_presence_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='玩家在线状态';

-- 大厅频道：只保留最近若干条，按时间清理
CREATE TABLE IF NOT EXISTS chat_messages (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  body       VARCHAR(200) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_created (created_at),
  CONSTRAINT fk_chat_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='大厅频道消息';
