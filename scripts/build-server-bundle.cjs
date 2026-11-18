#!/usr/bin/env node
/* Equivalent of build-server-bundle.py for hosts without Python.
   Rebuilds deploy/esf-server-bundle.zip from server/ and its manifest. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'server');
const OUT_DIR = path.join(ROOT, 'deploy');
const ZIP_PATH = path.join(OUT_DIR, 'esf-server-bundle.zip');
const MANIFEST_PATH = path.join(OUT_DIR, 'esf-server-bundle.manifest.json');
const TOP_FILES = ['package.json', 'package-lock.json', '.env.example', 'README.md'];
const INCLUDE_DIRS = ['src', 'sql'];
const EXCLUDE = new Set(['acceptance-sim.cjs']);
const SENSITIVE = ['PASSWORD', 'SECRET', 'TOKEN', '_KEY', 'CREDENTIAL'];
const NON_SECRET = ['TTL', 'SECONDS', 'MINUTES', 'MAX', 'HOST', 'PORT', 'USER', 'URL', 'DIR', 'SIZE'];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
}
function rel(p) { return path.relative(SRC, p).split(path.sep).join('/'); }

const files = [];
for (const name of TOP_FILES) {
  const p = path.join(SRC, name);
  if (fs.existsSync(p) && fs.statSync(p).isFile()) files.push(p);
}
for (const dir of INCLUDE_DIRS) {
  const base = path.join(SRC, dir);
  if (!fs.existsSync(base)) continue;
  const all = [];
  walk(base, all);
  for (const p of all) if (['.js', '.cjs', '.sql', '.json'].includes(path.extname(p))) files.push(p);
}
const scriptsDir = path.join(SRC, 'scripts');
if (fs.existsSync(scriptsDir)) {
  for (const name of fs.readdirSync(scriptsDir).sort()) {
    const p = path.join(scriptsDir, name);
    if (fs.statSync(p).isFile() && ['.js', '.cjs'].includes(path.extname(p)) && !EXCLUDE.has(name)) files.push(p);
  }
}
if (!files.length) throw new Error('no source files found');
if (files.some((p) => path.basename(p) === '.env')) throw new Error('refusing to bundle server/.env');

for (const line of fs.readFileSync(path.join(SRC, '.env.example'), 'utf8').split(/\r?\n/)) {
  const text = line.trim();
  if (!text || text.startsWith('#') || !text.includes('=')) continue;
  const [key, ...rest] = text.split('=');
  const upper = key.toUpperCase();
  if (!SENSITIVE.some((part) => upper.includes(part))) continue;
  if (NON_SECRET.some((part) => upper.includes(part))) continue;
  const value = rest.join('=');
  if (value && !value.startsWith('CHANGE_ME')) throw new Error('refusing to bundle .env.example: ' + key + ' has a non-placeholder value');
}

const migrate = fs.readFileSync(path.join(SRC, 'scripts', 'migrate.js'), 'utf8');
const sqlCount = fs.readdirSync(path.join(SRC, 'sql')).filter((n) => n.endsWith('.sql')).length;
const routeCount = fs.readdirSync(path.join(SRC, 'src', 'routes')).filter((n) => n.endsWith('.js')).length;
const envVars = fs.readFileSync(path.join(SRC, '.env.example'), 'utf8').split(/\r?\n/)
  .filter((line) => line && !line.startsWith('#') && line.includes('=')).length;

fs.mkdirSync(OUT_DIR, { recursive: true });
const listPath = path.join(OUT_DIR, '.bundle-files.txt');
fs.writeFileSync(listPath, files.map(rel).join('\n') + '\n', 'utf8');
const tar = spawnSync('tar.exe', ['-a', '-c', '-f', ZIP_PATH, '-C', SRC, '-T', listPath], { stdio: 'inherit' });
fs.rmSync(listPath, { force: true });
if (tar.status !== 0) throw new Error('tar failed: ' + tar.status);

const digest = crypto.createHash('sha256').update(fs.readFileSync(ZIP_PATH)).digest('hex');
const launcherVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'esf-launcher', 'package.json'), 'utf8')).version;
const serverVersion = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8')).version;
const manifest = {
  launcherVersion,
  serverVersion,
  sha256: digest,
  size: fs.statSync(ZIP_PATH).size,
  fileCount: files.length,
  sqlCount,
  routeCount,
  envTemplateVars: envVars,
  hasSettlementProcedures: migrate.includes('settle_ranked_match') && migrate.includes('settle_challenge_match'),
  builtAt: new Date().toISOString(),
};
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('zip      : ' + ZIP_PATH + ' (' + manifest.size + ' bytes, ' + files.length + ' files)');
console.log('sha256   : ' + digest);
console.log('manifest : ' + MANIFEST_PATH);
console.log('sql=' + sqlCount + ' routes=' + routeCount + ' envVars=' + envVars + ' settlement=' + manifest.hasSettlementProcedures);
