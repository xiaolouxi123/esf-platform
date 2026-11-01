-- =====================================================================
-- 平台运营设置：公告 / 维护模式（管理员可在客户端直接改，无需重启）
-- =====================================================================

USE esf_platform;

CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key   VARCHAR(48) PRIMARY KEY,
  setting_value TEXT NULL,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB COMMENT='平台级运营设置';

INSERT INTO platform_settings (setting_key, setting_value)
VALUES ('notice', ''), ('maintenance', '0'), ('maintenance_text', '')
ON DUPLICATE KEY UPDATE setting_value = setting_value;
