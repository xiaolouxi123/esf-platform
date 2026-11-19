-- 040 arena tickets (only 114 fcx-1v1-1 writes rows)
CREATE TABLE IF NOT EXISTS arena_tickets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token CHAR(32) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  server_key VARCHAR(32) NOT NULL,
  purpose ENUM('join','spectate','queue') NOT NULL DEFAULT 'join',
  state ENUM('waiting','in_server','queued','matched','spectating','closed') NOT NULL DEFAULT 'waiting',
  match_id BIGINT UNSIGNED NULL,
  ip VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_arena_ticket_token (token),
  KEY idx_arena_ticket_server (server_key, state, created_at),
  KEY idx_arena_ticket_user (user_id, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ranked_flags (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  match_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  opponent_id BIGINT UNSIGNED NULL,
  kind VARCHAR(32) NOT NULL,
  detail VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ranked_flags_match (match_id),
  KEY idx_ranked_flags_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
