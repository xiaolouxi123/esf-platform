'use strict';

/**
 * 最小 TOTP（RFC 6238，SHA-1，6 位，30 秒步长）实现。
 * 不引第三方依赖：账号量小，验算成本可以忽略。
 */

const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;
const DIGITS = 6;

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  const clean = String(text || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const idx = ALPHABET.indexOf(char);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', secretBuf).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function codeAt(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 1000 / STEP);
  return hotp(base32Decode(secret), counter);
}

/** window=1 表示容忍前后各一个时间片（时钟漂移）。 */
function verify(secret, code, window = 1) {
  const input = String(code || '').trim();
  if (!/^\d{6}$/.test(input)) return false;
  const counter = Math.floor(Date.now() / 1000 / STEP);
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = hotp(base32Decode(secret), counter + offset);
    if (
      expected.length === input.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(input))
    ) {
      return true;
    }
  }
  return false;
}

function otpauthUrl(secret, account, issuer = 'ESF Platform') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = { generateSecret, codeAt, verify, otpauthUrl, base32Decode, base32Encode };
