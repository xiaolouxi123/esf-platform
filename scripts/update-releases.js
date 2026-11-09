#!/usr/bin/env node
/**
 * 同步“平台历史版本”说明（src/data/releases.json）。
 * 用法：node scripts/update-releases.js <version> "<notes>" [date]
 *   notes 用「；」或「;」分隔，第一段作为 summary，其余作为 items。
 * 发布脚本会在提交前调用，保证每个版本都出现在客户端「版本记录」里。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'esf-launcher', 'src', 'data', 'releases.json');

const version = process.argv[2];
const rawNotes = process.argv[3] || '';
const date = process.argv[4] || new Date().toISOString().slice(0, 10);

if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('usage: node scripts/update-releases.js <x.y.z> "<notes>" [YYYY-MM-DD]');
  process.exit(1);
}

const parts = rawNotes
  .split(/[；;]/)
  .map((s) => s.trim())
  .filter(Boolean);

const summary = parts[0] || `${version} 版本更新`;
const items = parts.length > 1 ? parts.slice(1) : parts;

const list = JSON.parse(fs.readFileSync(file, 'utf8'));
const entry = { version, date, summary, items };
const index = list.findIndex((row) => row.version === version);
if (index >= 0) list[index] = entry;
else list.unshift(entry);

fs.writeFileSync(file, JSON.stringify(list, null, 2) + '\n', 'utf8');
console.log(`releases.json: ${index >= 0 ? 'updated' : 'added'} ${version}`);
