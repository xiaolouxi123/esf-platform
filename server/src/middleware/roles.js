'use strict';

const { forbidden } = require('../lib/errors');

/** 角色守卫：admin 拥有全部权限，gm 只能做运营/审核类操作 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(forbidden('没有权限执行该操作'));
    }
    next();
  };
}

const isAdmin = (user) => Boolean(user && user.role === 'admin');
const isStaff = (user) => Boolean(user && (user.role === 'admin' || user.role === 'gm'));

module.exports = { requireRole, isAdmin, isStaff };
