'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const env = require('./env');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '32kb' }));

app.use('/api', require('./routes/health'));
app.use('/api', require('./routes/config'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/me'));
app.use('/api', require('./routes/launch'));
app.use('/api', require('./routes/servers'));
app.use('/api', require('./routes/assets'));
app.use('/api', require('./routes/admin'));
app.use('/api', require('./routes/presence'));
app.use('/api', require('./routes/members'));
app.use('/api', require('./routes/chat'));
app.use('/api', require('./routes/titles'));
app.use('/api', require('./routes/economy'));
app.use('/api', require('./routes/ranked'));
app.use('/api', require('./routes/challenges'));
app.use('/api', require('./routes/favorites'));
app.use('/api/ranks', require('./routes/ranks'));

// electron-updater 的差量更新会发多段 Range（bytes=a-b,c-d），
// Express 自带的 static 只支持单段，会回 200 整包导致退化成全量下载。
// 这里补一个 multipart/byteranges 响应，让 0.2.x 更新只下变化的那 1MB。
function multiRangeUpdates(req, res, next) {
  const header = req.headers.range;
  if (!header || !/^bytes=/i.test(header)) return next();

  const specs = header
    .replace(/^bytes=/i, '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (specs.length < 2 || specs.length > 64) return next();

  const name = path.basename(decodeURIComponent(req.path));
  const root = path.resolve(env.updateDir);
  const file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep)) return next();

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return next();

    const ranges = [];
    for (const spec of specs) {
      const match = /^(\d*)-(\d*)$/.exec(spec);
      if (!match) return next();
      let start = match[1] === '' ? null : Number(match[1]);
      let end = match[2] === '' ? null : Number(match[2]);
      if (start === null) {
        if (end === null || end <= 0) return next();
        start = Math.max(0, stat.size - end);
        end = stat.size - 1;
      } else if (end === null || end >= stat.size) {
        end = stat.size - 1;
      }
      if (start < 0 || start > end || start >= stat.size) return next();
      ranges.push([start, end]);
    }

    const boundary = `ESF_RANGE_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`;
    res.status(206);
    res.setHeader('Content-Type', `multipart/byteranges; boundary=${boundary}`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');

    (async () => {
      try {
        for (const [start, end] of ranges) {
          res.write(
            `--${boundary}\r\n` +
              'Content-Type: application/octet-stream\r\n' +
              `Content-Range: bytes ${start}-${end}/${stat.size}\r\n` +
              `Content-Length: ${end - start + 1}\r\n\r\n`
          );
          await new Promise((resolve, reject) => {
            const stream = fs.createReadStream(file, { start, end });
            stream.on('error', reject);
            stream.on('end', resolve);
            stream.pipe(res, { end: false });
          });
          res.write('\r\n');
        }
        res.end(`--${boundary}--\r\n`);
      } catch (streamErr) {
        res.destroy(streamErr);
      }
    })();
  });
}

// 启动器自动更新源：把 latest.yml / 安装包 / blockmap 放进 UPDATE_DIR
app.use(
  '/updates',
  multiRangeUpdates,
  express.static(env.updateDir, {
    fallthrough: true,
    maxAge: '1h',
    setHeaders(res) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    },
  })
);

// 官网（与 API / updates 同源，避免额外域名和证书配置）
const websiteDir = path.join(__dirname, '..', '..', 'website');
app.use(
  express.static(websiteDir, {
    index: 'index.html',
    maxAge: '10m',
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
