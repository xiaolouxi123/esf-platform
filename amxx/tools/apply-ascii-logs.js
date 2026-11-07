// Replace console/log Chinese string literals with ASCII English ones.
// Usage: node apply-ascii-logs.js <amxxDir>
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || '.';
const mapPath = path.join(__dirname, 'ascii-log-map.json');
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));

let total = 0;
for (const [file, lines] of Object.entries(map)) {
  const p = path.join(dir, file);
  const text = fs.readFileSync(p, 'utf8');
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const arr = text.split(/\r?\n/);
  for (const [lineNo, ascii] of Object.entries(lines)) {
    const i = Number(lineNo) - 1;
    const line = arr[i];
    const q1 = line.indexOf('"');
    if (q1 < 0) throw new Error(`${file}:${lineNo} no quote`);
    const q2 = line.indexOf('"', q1 + 1);
    if (q2 < 0) throw new Error(`${file}:${lineNo} no closing quote`);
    const inner = line.slice(q1 + 1, q2);
    if (!/[\u4e00-\u9fff]/.test(inner)) throw new Error(`${file}:${lineNo} literal has no CJK: ${inner}`);
    arr[i] = line.slice(0, q1 + 1) + ascii + line.slice(q2);
    total++;
  }
  fs.writeFileSync(p, arr.join(nl), 'utf8');
  console.log(`patched ${file}: ${Object.keys(lines).length}`);
}
console.log(`total ${total}`);
