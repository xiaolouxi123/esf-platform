-- =====================================================================
-- 角色升级（方案 B：user < creator < ops < admin < owner）+ 操作审计
-- 幂等：可重复执行
-- =====================================================================

USE esf_platform;

-- 老的 gm 并入 ops
ALTER TABLE users
  MODIFY COLUMN role ENUM('user','creator','ops','admin','owner') NOT NULL DEFAULT 'user';

UPDATE users SET role = 'ops' WHERE role = 'gm';

-- 操作审计：谁、什么时候、对谁、做了什么、改前改后
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_id    BIGINT UNSIGNED NULL,
  actor_name  VARCHAR(32) NULL COMMENT '快照：账号删了日志也留得住',
  action      VARCHAR(48) NOT NULL COMMENT 'user.ban / user.role / asset.approve …',
  target_type VARCHAR(24) NULL,
  target_id   BIGINT UNSIGNED NULL,
  detail      JSON NULL COMMENT '变更前后值',
  ip          VARCHAR(45) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_created (created_at),
  KEY idx_actor (actor_id),
  KEY idx_action (action)
) ENGINE=InnoDB COMMENT='管理操作审计';
