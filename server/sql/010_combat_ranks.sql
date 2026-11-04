-- 格斗等级展示配置：0=未定级，1-6 对应 D/C/B/A/X/S
-- 等级值仍存放在 users.combat_level，管理台只改展示名、颜色与排序，避免破坏战绩逻辑。
CREATE TABLE IF NOT EXISTS combat_ranks (
  level TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  name VARCHAR(16) NOT NULL,
  color CHAR(7) NOT NULL DEFAULT '#94A0B8',
  sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO combat_ranks (level, name, color, sort_order) VALUES
  (0, '未定级', '#7C879E', 0),
  (1, 'D', '#9AA7BD', 1),
  (2, 'C', '#64D8A2', 2),
  (3, 'B', '#5DBBFF', 3),
  (4, 'A', '#B18CFF', 4),
  (5, 'X', '#FF8A5B', 5),
  (6, 'S', '#FFD166', 6)
ON DUPLICATE KEY UPDATE level = level;
