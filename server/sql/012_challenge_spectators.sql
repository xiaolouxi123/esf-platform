-- 约战观战记录：让观战者也能在赛后看到本场战绩。
-- 与 challenge_room_players 分离，观战者不占参赛席位、不参与 ready/人数校验。

CREATE TABLE IF NOT EXISTS challenge_spectators (
  room_id    BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  joined_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, user_id),
  KEY idx_challenge_spectator_user (user_id, room_id),
  CONSTRAINT fk_challenge_spectator_room FOREIGN KEY (room_id) REFERENCES challenge_rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_challenge_spectator_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='约战观战记录';
