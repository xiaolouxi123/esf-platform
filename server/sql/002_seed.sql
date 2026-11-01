-- =====================================================================
-- 初始数据（幂等）
-- =====================================================================

USE esf_platform;

INSERT INTO servers (server_key, name, ip, port, enabled, sort)
VALUES ('fcx-1v1-1', '[ESF-FCX]单挑房[1]', '114.132.84.150', 27016, 1, 10)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  ip = VALUES(ip),
  port = VALUES(port),
  enabled = VALUES(enabled),
  sort = VALUES(sort);
