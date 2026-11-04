-- 约战规则、结果与个人统计。与 008 的挑战房间配套；
-- 独立表避免 ALTER 老库，同时保留房间等待/进行中的原始字段。
CREATE TABLE IF NOT EXISTS challenge_configs (
  room_id       BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  victory_type  ENUM('kills','deaths') NOT NULL DEFAULT 'kills',
  victory_limit TINYINT UNSIGNED NOT NULL DEFAULT 10,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cc_room FOREIGN KEY (room_id) REFERENCES challenge_rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='约战胜利条件';

CREATE TABLE IF NOT EXISTS challenge_results (
  room_id       BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  winner        ENUM('a','b') NOT NULL,
  score_a       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  score_b       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  victory_type  ENUM('kills','deaths') NOT NULL,
  victory_limit TINYINT UNSIGNED NOT NULL,
  ended_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cr_room FOREIGN KEY (room_id) REFERENCES challenge_rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='约战结果';

CREATE TABLE IF NOT EXISTS challenge_player_stats (
  room_id  BIGINT UNSIGNED NOT NULL,
  user_id  BIGINT UNSIGNED NOT NULL,
  team     ENUM('a','b') NOT NULL,
  kills    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  deaths   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, user_id),
  CONSTRAINT fk_cps_room FOREIGN KEY (room_id) REFERENCES challenge_rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_cps_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='约战个人战绩';
