-- 038: 标记比赛服（天梯 / 约战池），与公开服区分
ALTER TABLE servers
  ADD COLUMN is_match TINYINT(1) NOT NULL DEFAULT 0 AFTER mode;

UPDATE servers SET is_match = 1
 WHERE server_key IN ('fcx-1v1-1', 'fcx-1v1-3', 'fcx-1v1-4');
