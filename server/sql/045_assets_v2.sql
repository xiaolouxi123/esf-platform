USE esf_platform;

-- 资源库 v2：整包文件、版本历史、评分、评论、举报、合集、下载去重
-- 新列由 scripts/migrate.js 的 ensureColumn 补；这里只建新表。

CREATE TABLE IF NOT EXISTS asset_files (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id BIGINT UNSIGNED NOT NULL,
  version VARCHAR(32) NOT NULL,
  relative_path VARCHAR(300) NOT NULL COMMENT '相对模组目录的落地路径',
  stored_path VARCHAR(400) NOT NULL COMMENT '相对 uploads 的存储路径',
  file_name VARCHAR(255) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  mime VARCHAR(100) NULL,
  sort INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_asset_version_path (asset_id, version, relative_path),
  KEY idx_asset_version (asset_id, version),
  CONSTRAINT fk_asset_file_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资源包内文件清单';

CREATE TABLE IF NOT EXISTS asset_versions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id BIGINT UNSIGNED NOT NULL,
  version VARCHAR(32) NOT NULL,
  changelog VARCHAR(1000) NULL,
  total_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  file_count INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved',
  review_note VARCHAR(255) NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_asset_version (asset_id, version),
  CONSTRAINT fk_asset_version_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资源版本历史';

CREATE TABLE IF NOT EXISTS asset_ratings (
  asset_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  stars TINYINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (asset_id, user_id),
  KEY idx_rating_asset (asset_id),
  CONSTRAINT fk_rating_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  CONSTRAINT fk_rating_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资源评分 1-5 星';

CREATE TABLE IF NOT EXISTS asset_comments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  body VARCHAR(500) NOT NULL,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comment_asset (asset_id, created_at),
  CONSTRAINT fk_comment_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资源评论';

CREATE TABLE IF NOT EXISTS asset_reports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  reason VARCHAR(500) NOT NULL,
  status ENUM('open','resolved','dismissed') NOT NULL DEFAULT 'open',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  handled_by BIGINT UNSIGNED NULL,
  handled_at DATETIME NULL,
  KEY idx_report_status (status, created_at),
  CONSTRAINT fk_report_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资源举报';

CREATE TABLE IF NOT EXISTS asset_collections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(64) NOT NULL,
  title VARCHAR(64) NOT NULL,
  description VARCHAR(300) NULL,
  sort INT NOT NULL DEFAULT 0,
  featured TINYINT(1) NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_collection_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资源合集';

CREATE TABLE IF NOT EXISTS asset_collection_items (
  collection_id BIGINT UNSIGNED NOT NULL,
  asset_id BIGINT UNSIGNED NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, asset_id),
  KEY idx_collection_asset (asset_id),
  CONSTRAINT fk_collection_item_collection FOREIGN KEY (collection_id) REFERENCES asset_collections(id) ON DELETE CASCADE,
  CONSTRAINT fk_collection_item_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='合集内容';

CREATE TABLE IF NOT EXISTS asset_downloads (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_id BIGINT UNSIGNED NOT NULL,
  day DATE NOT NULL,
  dedupe_key VARCHAR(80) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_asset_day_dedupe (asset_id, day, dedupe_key),
  CONSTRAINT fk_download_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='下载去重（同一用户/同一天只计一次）';

-- 旧资源回填：每个旧资源补一条版本记录与一条文件记录
INSERT IGNORE INTO asset_versions (asset_id, version, changelog, total_size, file_count, created_by, created_at)
SELECT id, version, NULL, file_size, 1, author_id, created_at FROM assets;

INSERT IGNORE INTO asset_files
  (asset_id, version, relative_path, stored_path, file_name, file_size, sha256, mime, sort, created_at)
SELECT a.id, a.version, a.target_path,
       CONCAT(IF(a.kind IN ('map','model','sound','sprite'), a.kind, 'other'), '/', a.stored_name),
       a.file_name, a.file_size, a.sha256, NULL, 0, a.created_at
FROM assets a;