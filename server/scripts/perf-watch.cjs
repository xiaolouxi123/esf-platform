'use strict';
/**
 * ESF perf-watch: 5s samples while players are online, 60s when idle.
 * Logs per-server players/FPS plus host CPU/free memory/NIC throughput.
 * Output: C:\esf\logs\perf-watch.csv
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

let Query;
try { ({ Query } = require('goldsrc-query')); }
catch { ({ Query } = require('C:/esf/server/node_modules/goldsrc-query')); }

const OUT = process.env.ESF_PERF_LOG || 'C:/esf/logs/perf-watch.csv';
const SERVERS = [
  { key: 'evm-27015', port: 27015 },
  { key: 'evm-27016', port: 27016 },
  { key: 'fcx-27017', port: 27017 },
];
const RCON = 'moo';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  return { idle, total };
}

function netBytes() {
  try {
    const text = execFileSync('netstat', ['-e'], { encoding: 'utf8', windowsHide: true });
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
      if (m) return { rx: Number(m[2]), tx: Number(m[3]) };
    }
  } catch { /* ignore */ }
  return null;
}

async function queryServer(server) {
  const q = new Query('127.0.0.1', server.port, 1200);
  try {
    q.connect();
    const info = await q.serverInfo();
    let fps = null;
    try {
      await q.connectRcon(RCON);
      // 单次 stats 的 FPS 是瞬时值，换图/进人时会抖到 40-80；取 3 次中位数，
      // 避免监控日志把正常波动误记成故障。
      const samples = [];
      for (let i = 0; i < 3; i += 1) {
        const r = await q.sendRcon('stats');
        const m = /\s([\d.]+)\s+(\d+)\s*$/.exec(String(r.data || '').replace(/\0/g, '').trim());
        if (m) samples.push(Number(m[1]));
        await sleep(300);
      }
      if (samples.length) {
        samples.sort((a, b) => a - b);
        fps = samples[Math.floor(samples.length / 2)];
      }
    } catch { /* rcon optional */ }
    return { players: Number(info.players) || 0, fps };
  } catch {
    return { players: 0, fps: null };
  } finally {
    try { q.close(); } catch { /* ignore */ }
  }
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  if (!fs.existsSync(OUT)) {
    fs.writeFileSync(OUT, 'time,total_players,evm27015_players,evm27016_players,fcx27017_players,evm27015_fps,evm27016_fps,fcx27017_fps,cpu_pct,free_mb,tx_kbps,rx_kbps\n');
  }
  let prevCpu = cpuTimes();
  let prevNet = netBytes();
  let prevNetAt = Date.now();
  let lastLog = 0;

  for (;;) {
    const started = Date.now();
    const results = await Promise.all(SERVERS.map(queryServer));
    const total = results.reduce((a, r) => a + r.players, 0);

    const now = Date.now();
    const cpu = cpuTimes();
    const dtTotal = Math.max(1, cpu.total - prevCpu.total);
    const dtIdle = Math.max(0, cpu.idle - prevCpu.idle);
    const cpuPct = Math.max(0, Math.min(100, (1 - dtIdle / dtTotal) * 100));
    prevCpu = cpu;

    const net = netBytes();
    let txKbps = '', rxKbps = '';
    if (net && prevNet) {
      const sec = Math.max(1, (now - prevNetAt) / 1000);
      txKbps = ((net.tx - prevNet.tx) * 8 / sec / 1000).toFixed(1);
      rxKbps = ((net.rx - prevNet.rx) * 8 / sec / 1000).toFixed(1);
      prevNet = net;
      prevNetAt = now;
    } else {
      prevNet = net;
      prevNetAt = now;
    }

    // Log every sample while someone is playing; idle heartbeat every 60s.
    if (total > 0 || now - lastLog >= 60000) {
      const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
      const row = [
        stamp,
        total,
        results[0].players,
        results[1].players,
        results[2].players,
        results[0].fps ?? '',
        results[1].fps ?? '',
        results[2].fps ?? '',
        cpuPct.toFixed(1),
        (os.freemem() / 1048576).toFixed(0),
        txKbps,
        rxKbps,
      ].join(',');
      fs.appendFileSync(OUT, row + '\n');
      lastLog = now;
    }

    const elapsed = Date.now() - started;
    await sleep(total > 0 ? Math.max(1000, 5000 - elapsed) : Math.max(1000, 60000 - elapsed));
  }
}

main().catch((err) => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.appendFileSync(OUT, '# fatal ' + new Date().toISOString() + ' ' + err.stack + '\n');
  process.exit(1);
});
