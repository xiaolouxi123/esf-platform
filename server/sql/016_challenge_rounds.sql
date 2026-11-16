-- 016: 约战单局结果（支持再来一局，最多 3 局）
CREATE TABLE IF NOT EXISTS challenge_rounds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id BIGINT UNSIGNED NOT NULL,
  round_no INT UNSIGNED NOT NULL DEFAULT 1,
  winner ENUM('a','b') NOT NULL DEFAULT 'a',
  score_a INT NOT NULL DEFAULT 0,
  score_b INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_round (room_id, round_no),
  CONSTRAINT fk_round_room FOREIGN KEY (room_id) REFERENCES challenge_rooms (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
