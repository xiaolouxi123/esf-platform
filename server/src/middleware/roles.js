'use strict';

/**
 * 角色与权限。
 *
 * 方案 B 五级：
 *   user < creator(作者) < ops(运营) < admin(管理员) < owner(所有者)
 *
 * 约定：
 *   - staff = ops / admin / owner，能进管理台
 *   - admin 以上才能改角色、看审计、用开发者工具
 *   - owner 唯一，不能被降级/封禁，只能通过「转让所有权」交接
 */

const ROLES = ['user', 'creator', 'ops', 'admin', 'owner'];

const RANK = { user: 0, creator: 1, ops: 2, admin: 3, owner: 4 };

const { forbidden } = require('../lib/errors');

function rankOf(role) {
  return RANK[role] ?? -1;
}

const isOwner = (user) => Boolean(user && user.role === 'owner');
const isAdmin = (user) => Boolean(user && (user.role === 'admin' || user.role === 'owner'));
const isStaff = (user) => Boolean(user && ['ops', 'admin', 'owner'].includes(user.role));

/** 角色守卫：传入允许的角色；也可以用 rank 做「至少某级」 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(forbidden('没有权限执行该操作'));
    }
    next();
  };
}

/** 至少达到某个级别（例如 atLeast('admin') 允许 admin 与 owner） */
function requireAtLeast(minRole) {
  return (req, res, next) => {
    if (!req.user || rankOf(req.user.role) < rankOf(minRole)) {
      return next(forbidden('权限不足'));
    }
    next();
  };
}

module.exports = { ROLES, RANK, rankOf, requireRole, requireAtLeast, isOwner, isAdmin, isStaff };
