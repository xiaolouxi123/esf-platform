-- =====================================================================
-- 约战房间：玩家创建房间、邀请好友、准备、开赛
-- 和排位队列完全独立：不计分、不锁服，只负责把一局人约到一起。
-- =====================================================================

USE esf_platform;

CREATE TABLE IF NOT EXISTS challenge_rooms (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  host_id      BIGINT UNSIGNED NOT NULL,
  title        VARCHAR(48) NOT NULL,
  mode         VARCHAR(8) NOT NULL COMMENT '1v1 / 2v2',
  map          VARCHAR(64) NULL,
  server_key   VARCHAR(32) NULL COMMENT '可选的比赛服；为空则房间内自行协商',
  status       ENUM('waiting','live','closed') NOT NULL DEFAULT 'waiting',
  max_players  TINYINT UNSIGNED NOT NULL DEFAULT 2,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at   DATETIME NULL,
  closed_at    DATETIME NULL,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_challenge_status (status, updated_at),
  KEY idx_challenge_host (host_id, status),
  CONSTRAINT fk_challenge_host FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='约战房间';

CREATE TABLE IF NOT EXISTS challenge_room_players (
  room_id    BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  team       ENUM('a','b') NOT NULL,
  ready      TINYINT NOT NULL DEFAULT 0,
  joined_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, user_id),
  KEY idx_challenge_player (user_id, room_id),
  CONSTRAINT fk_challenge_player_room FOREIGN KEY (room_id) REFERENCES challenge_rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_challenge_player_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='约战房间座位';

CREATE TABLE IF NOT EXISTS challenge_invites (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  room_id      BIGINT UNSIGNED NOT NULL,
  from_user_id BIGINT UNSIGNED NOT NULL,
  to_user_id   BIGINT UNSIGNED NOT NULL,
  status       ENUM('pending','accepted','declined','cancelled') NOT NULL DEFAULT 'pending',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at DATETIME NULL,
  UNIQUE KEY uk_challenge_invite (room_id, to_user_id),
  KEY idx_challenge_invite_to (to_user_id, status),
  CONSTRAINT fk_challenge_invite_room FOREIGN KEY (room_id) REFERENCES challenge_rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_challenge_invite_from FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_challenge_invite_to FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='约战邀请';
