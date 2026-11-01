-- =====================================================================
-- 资源库：模组用的模型 / 声音 / 其它文件
-- 用途：模型作者入驻后上传，管理员审核，启动器按 target_path 落地到模组
-- 幂等，可重复执行
-- =====================================================================

USE esf_platform;

CREATE TABLE IF NOT EXISTS assets (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kind        ENUM('model','sound','sprite','other') NOT NULL,
  name        VARCHAR(64)  NOT NULL COMMENT '展示名',
  slug        VARCHAR(64)  NOT NULL COMMENT '同 kind 下的稳定标识',
  version     VARCHAR(32)  NOT NULL DEFAULT '1.0.0',
  target_path VARCHAR(255) NOT NULL COMMENT '相对模组目录的落地路径，如 models/player/goku/goku.mdl',
  description VARCHAR(500) NULL,
  file_name   VARCHAR(255) NOT NULL COMMENT '作者上传时的原始文件名',
  stored_name VARCHAR(255) NOT NULL COMMENT '磁盘上的实际文件名',
  file_size   BIGINT UNSIGNED NOT NULL,
  sha256      CHAR(64) NOT NULL,
  author_id   BIGINT UNSIGNED NULL,
  status      ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  downloads   INT UNSIGNED NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_kind_slug_version (kind, slug, version),
  KEY idx_status_kind (status, kind),
  KEY idx_author (author_id),
  CONSTRAINT fk_asset_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='模型/声音资源';
