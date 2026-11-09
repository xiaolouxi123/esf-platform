-- 0.6 约战：锁服排队（观战席位表见 012_challenge_spectators.sql）
CREATE TABLE IF NOT EXISTS challenge_queue (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  server_key VARCHAR(34) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('ranked','challenge') NOT NULL DEFAULT 'challenge',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_queue_user (server_key, user_id),
  KEY idx_queue_server (server_key, created_at),
  CONSTRAINT fk_queue_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
