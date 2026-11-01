-- =====================================================================
-- 资源类型新增：sprite（特效贴图 .spr）
-- 幂等：可重复执行
-- =====================================================================

USE esf_platform;

ALTER TABLE assets
  MODIFY COLUMN kind ENUM('model','sound','sprite','other') NOT NULL;
