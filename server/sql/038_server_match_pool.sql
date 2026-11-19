-- 038: 标记比赛服（天梯 / 约战池），与公开服区分
ALTER TABLE servers
  ADD COLUMN is_match TINYINT(1) NOT NULL DEFAULT 0 AFTER mode;

-- 只有 114 的 [ESF-FCX]单挑房[1] 进天梯/约战池，其余全部按公开服处理。
UPDATE servers SET is_match = IF(server_key = 'fcx-1v1-1', 1, 0);
