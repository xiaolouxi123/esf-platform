-- 041: 约战专用服务器池。天梯池只保留 114 单挑1；约战池改为 217 的两台 2.1。
ALTER TABLE servers
  ADD COLUMN is_challenge TINYINT(1) NOT NULL DEFAULT 0 AFTER is_match;

UPDATE servers SET is_challenge = IF(server_key IN ('fcx-1v1-3', 'fcx-1v1-4'), 1, 0);
