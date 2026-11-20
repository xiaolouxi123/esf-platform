'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');

const DEFAULT_LIMITS = {
  maxFiles: 200,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
};

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function readUInt64(buffer, offset) {
  const low = buffer.readUInt32LE(offset);
  const high = buffer.readUInt32LE(offset + 4);
  return high * 0x100000000 + low;
}

function findEocd(buffer) {
  const start = Math.max(0, buffer.length - 66000);
  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) return i;
  }
  return -1;
}

function safeEntryPath(raw) {
  const value = String(raw || '').replace(/\\/g, '/');
  if (!value || value.startsWith('/') || /^[a-zA-Z]:/.test(value)) {
    throw new Error('压缩包包含绝对路径: ' + value);
  }
  if (value.includes('\u0000')) throw new Error('压缩包路径包含 NUL');
  const parts = value.split('/').filter((part) => part && part !== '.');
  if (!parts.length) throw new Error('压缩包路径为空');
  for (const part of parts) {
    if (part === '..') throw new Error('压缩包包含 .. 路径: ' + value);
  }
  return parts.join('/');
}

function unixMode(externalAttrs) {
  return (externalAttrs >>> 16) & 0xffff;
}

/**
 * 只解压 zip 的普通文件。不支持 zip64 / 加密 / 符号链接。
 * 返回写入的文件清单，路径一律相对 destDir。
 */
async function extractZip(zipPath, destDir, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const buffer = await fsp.readFile(zipPath);
  const eocd = findEocd(buffer);
  if (eocd < 0) throw new Error('不是有效的 zip 文件');

  const disk = buffer.readUInt16LE(eocd + 4);
  const cdDisk = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const entries = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (disk !== 0 || cdDisk !== 0) throw new Error('不支持分卷 zip');
  if (entries === 0xffff || entriesOnDisk === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error('不支持 zip64，请重新压缩为普通 zip');
  }
  if (entries > limits.maxFiles) throw new Error('压缩包文件数超过 ' + limits.maxFiles);
  if (cdOffset + cdSize > buffer.length) throw new Error('zip 中央目录损坏');

  await fsp.mkdir(destDir, { recursive: true });
  const written = [];
  let cursor = cdOffset;
  let total = 0;

  for (let index = 0; index < entries; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL) throw new Error('zip 中央目录项损坏');
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const externalAttrs = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLen);
    cursor += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) throw new Error('不支持加密 zip');
    const mode = unixMode(externalAttrs);
    if ((mode & 0o170000) === 0o120000) throw new Error('压缩包包含符号链接: ' + name);
    if (name.endsWith('/')) continue;
    if (method !== 0 && method !== 8) throw new Error('不支持的压缩方式: ' + method);

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL) {
      throw new Error('zip 本地文件头损坏');
    }
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compressedSize > buffer.length) throw new Error('zip 文件数据越界');
    const relative = safeEntryPath(name);
    if (uncompressedSize > limits.maxFileBytes) throw new Error('单个文件超过限制: ' + relative);
    total += uncompressedSize;
    if (total > limits.maxTotalBytes) throw new Error('解压后总大小超过限制');

    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) {
      data = Buffer.from(compressed);
    } else {
      try {
        data = zlib.inflateRawSync(compressed, { maxOutputLength: limits.maxFileBytes });
      } catch (err) {
        throw new Error('解压失败 ' + relative + ': ' + err.message);
      }
    }
    if (data.length !== uncompressedSize) throw new Error('解压大小不一致: ' + relative);
    const target = path.join(destDir, ...relative.split('/'));
    if (!target.startsWith(path.resolve(destDir) + path.sep)) throw new Error('解压路径越界: ' + relative);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, data);
    written.push({ path: relative, size: data.length });
  }

  return { files: written, totalBytes: total };
}

async function collectDirectory(root) {
  const base = path.resolve(root);
  const files = [];
  async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.esf-backup' || entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        const stat = await fsp.stat(abs);
        files.push({ path: path.relative(base, abs).split(path.sep).join('/'), size: stat.size, absolute: abs });
      }
    }
  }
  await walk(base);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

module.exports = { extractZip, collectDirectory, DEFAULT_LIMITS, safeEntryPath };
