'use strict';

/**
 * 邮件发送（QQ 邮箱 SMTP）。
 *
 * QQ 邮箱必须用「授权码」而不是登录密码：设置 → 账户 → POP3/SMTP 服务 → 开启 → 生成授权码。
 * 没配置 SMTP_USER / SMTP_PASS 时 mailEnabled() 为 false，验证码接口会返回 503，
 * 这样本地开发不会因为缺配置而崩。
 */

const nodemailer = require('nodemailer');
const env = require('../env');

let transporter = null;

function mailEnabled() {
  return Boolean(env.smtpUser && env.smtpPass);
}

function getTransport() {
  if (!mailEnabled()) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: {
      user: env.smtpUser,
      // QQ 邮箱要求使用授权码；这里允许直接填授权码
      pass: env.smtpPass,
    },
    pool: true,
    maxConnections: 1,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return transporter;
}

function fromAddress() {
  return env.smtpFrom || `ESF 平台 <${env.smtpUser}>`;
}

const PURPOSE_TEXT = {
  bind: '绑定邮箱',
  reset: '重置密码',
};

/**
 * 发送 6 位验证码。
 * @param {string} to 收件地址
 * @param {string} code 6 位数字
 * @param {'bind'|'reset'} purpose
 */
async function sendCode(to, code, purpose) {
  const transport = getTransport();
  if (!transport) {
    const err = new Error('邮件服务未配置');
    err.code = 'MAIL_DISABLED';
    throw err;
  }

  const action = PURPOSE_TEXT[purpose] || '验证';
  const ttl = env.resetCodeTtlMinutes;

  await transport.sendMail({
    from: fromAddress(),
    to,
    subject: `【ESF 平台】${action}验证码：${code}`,
    text: [
      `你正在进行「${action}」，验证码：${code}`,
      '',
      `验证码 ${ttl} 分钟内有效，只能使用一次。`,
      '如果不是你本人操作，忽略这封邮件即可；你的密码不会被修改。',
      '',
      '—— ESF 平台',
    ].join('\n'),
    html: `
      <div style="font-family:Segoe UI,Microsoft YaHei,sans-serif;background:#0b0e14;color:#eef1f7;padding:28px;border-radius:14px">
        <div style="font-size:12px;letter-spacing:.18em;color:#ff8a1f">ESF PLATFORM</div>
        <h2 style="margin:10px 0 6px">${action}</h2>
        <p style="color:#a4adc2;margin:0 0 18px">请在页面里输入下面的验证码：</p>
        <div style="font-size:34px;letter-spacing:10px;font-weight:700;color:#ff8a1f">${code}</div>
        <p style="color:#7a8399;font-size:12px;margin-top:18px">${ttl} 分钟内有效，只能使用一次。非本人操作请忽略本邮件。</p>
      </div>`,
  });
}

module.exports = { mailEnabled, sendCode };
