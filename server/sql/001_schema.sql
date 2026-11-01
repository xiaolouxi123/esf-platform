-- =====================================================================
-- ESF 平台数据库结构（MySQL 8 / utf8mb4）
-- 幂等：可重复执行
-- =====================================================================

CREATE DATABASE IF NOT EXISTS esf_platform
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

USE esf_platform;

-- ---------------------------------------------------------------------
-- 账号
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(32)  NOT NULL COMMENT '登录名，字母数字下划线',
  password_hash VARCHAR(255) NOT NULL COMMENT 'bcrypt',
  game_name     VARCHAR(32)  NOT NULL COMMENT '游戏内昵称，允许中文',
  role          ENUM('user','creator','ops','admin','owner') NOT NULL DEFAULT 'user',
  status        ENUM('active','banned')   NOT NULL DEFAULT 'active',
  token_version INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '递增即可让所有旧 JWT 失效',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL,
  UNIQUE KEY uk_username (username)
) ENGINE=InnoDB COMMENT='平台账号';

-- ---------------------------------------------------------------------
-- 一次性连服凭证（客户端拿不到数据库，只能拿到这张表里的一行）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS launch_tokens (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token      CHAR(32) NOT NULL COMMENT '16 字节随机 hex',
  user_id    BIGINT UNSIGNED NOT NULL,
  server_key VARCHAR(32) NOT NULL COMMENT '绑定服务器，跨服不可用',
  expires_at DATETIME NOT NULL,
  used_at    DATETIME NULL COMMENT '首次被消费的时间，不可再当作首次凭证',
  authorized_until DATETIME NULL COMMENT '已在本服放行过的复用窗口：GoldSrc 换图会让客户端重连并重发同一份 userinfo',
  used_ip    VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_token (token),
  KEY idx_user (user_id, created_at),
  KEY idx_expire (expires_at),
  CONSTRAINT fk_lt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='连服 Token';

-- ---------------------------------------------------------------------
-- 服务器列表
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS servers (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  server_key VARCHAR(32) NOT NULL COMMENT 'AMXX 用它校验 token 归属',
  name       VARCHAR(64) NOT NULL,
  ip         VARCHAR(45) NOT NULL,
  port       SMALLINT UNSIGNED NOT NULL,
  enabled    TINYINT(1) NOT NULL DEFAULT 1,
  sort       INT NOT NULL DEFAULT 0,
  UNIQUE KEY uk_key (server_key)
) ENGINE=InnoDB COMMENT='游戏服务器';

CREATE TABLE IF NOT EXISTS server_status (
  server_id   INT UNSIGNED PRIMARY KEY,
  name        VARCHAR(96) NULL,
  map         VARCHAR(64) NULL,
  players     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  max_players SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ping_ms     INT NOT NULL DEFAULT 0,
  online      TINYINT(1) NOT NULL DEFAULT 0,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ss FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='A2S 轮询结果缓存';

-- ---------------------------------------------------------------------
-- 在线记录（AMXX 写）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS play_sessions (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  server_key   VARCHAR(32) NOT NULL,
  token_id     BIGINT UNSIGNED NULL,
  started_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at     DATETIME NULL,
  duration_sec INT UNSIGNED NULL,
  KEY idx_user_time (user_id, started_at)
) ENGINE=InnoDB COMMENT='玩家在服时长';

-- ---------------------------------------------------------------------
-- 登录审计
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_logs (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username   VARCHAR(32) NULL,
  user_id    BIGINT UNSIGNED NULL,
  ip         VARCHAR(45) NULL,
  success    TINYINT(1) NOT NULL,
  reason     VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_time (created_at)
) ENGINE=InnoDB COMMENT='登录审计';

-- ---------------------------------------------------------------------
-- 给 AMXX 用的白名单视图：绝不暴露 password_hash
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_platform_users AS
  SELECT id, username, game_name, role, status FROM users;
