-- ---------------------------------------------------------------------
-- 014 账号安全：邮箱绑定 / 自助找回 / 登录锁定 / 强制改密
-- ---------------------------------------------------------------------

-- 6 位邮箱验证码（绑定邮箱、重置密码共用；只存 hash，不存明文）
CREATE TABLE IF NOT EXISTS email_codes (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NULL COMMENT '重置密码时用户可能不存在，允许 NULL',
  email      VARCHAR(190) NOT NULL,
  code_hash  CHAR(64)     NOT NULL COMMENT 'sha256(code + salt) 的 hex',
  purpose    ENUM('bind','reset') NOT NULL,
  attempts   INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME     NOT NULL,
  used_at    DATETIME     NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_email_code_lookup (email, purpose, created_at),
  KEY idx_email_code_user (user_id, purpose, created_at)
) ENGINE=InnoDB COMMENT='邮箱验证码（绑定/找回）';

-- 一次性重置令牌（验证码校验通过后换取，短有效期）
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64)     NOT NULL,
  expires_at DATETIME     NOT NULL,
  used_at    DATETIME     NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_prt_token (token_hash),
  KEY idx_prt_user (user_id, created_at)
) ENGINE=InnoDB COMMENT='密码重置令牌';
