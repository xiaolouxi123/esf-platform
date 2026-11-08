-- 远程维护通道：114 游戏服上的拉取式 agent 从这里领任务、回传结果。
-- 之所以反过来让 agent 来拉：114 的 5985 被腾讯云安全组挡着，入站进不来。

CREATE TABLE IF NOT EXISTS ops_jobs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cmd         TEXT NOT NULL,
  cwd         VARCHAR(255) NULL,
  timeout_sec INT UNSIGNED NOT NULL DEFAULT 120,
  status      ENUM('pending','running','done','failed') NOT NULL DEFAULT 'pending',
  exit_code   INT NULL,
  stdout      MEDIUMTEXT NULL,
  stderr      MEDIUMTEXT NULL,
  agent       VARCHAR(64) NULL,
  created_by  BIGINT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at  DATETIME NULL,
  finished_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_ops_status_id (status, id),
  KEY idx_ops_created (created_at)
) ENGINE=InnoDB COMMENT='远程维护任务队列';

CREATE TABLE IF NOT EXISTS ops_agents (
  agent        VARCHAR(64) NOT NULL,
  hostname     VARCHAR(64) NULL,
  last_ip      VARCHAR(45) NULL,
  version      VARCHAR(16) NULL,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (agent)
) ENGINE=InnoDB COMMENT='维护 agent 心跳';
