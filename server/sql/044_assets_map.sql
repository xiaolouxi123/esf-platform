-- =====================================================================
-- 资源类型新增：map（地图 .bsp）
-- 幂等：可重复执行
-- =====================================================================

USE esf_platform;

ALTER TABLE assets
  MODIFY COLUMN kind ENUM('map','model','sound','sprite','other') NOT NULL;
