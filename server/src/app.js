'use strict';

const express = require('express');

const env = require('./env');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '32kb' }));

app.get('/', (req, res) => {
  res.json({
    ok: true,
    data: { name: 'ESF 平台后端', version: env.version, docs: '/api/health' },
  });
});

app.use('/api', require('./routes/health'));
app.use('/api', require('./routes/config'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/me'));
app.use('/api', require('./routes/launch'));
app.use('/api', require('./routes/servers'));
app.use('/api', require('./routes/assets'));
app.use('/api', require('./routes/admin'));
app.use('/api', require('./routes/presence'));
app.use('/api', require('./routes/chat'));

// 启动器自动更新源：把 latest.yml / 安装包 / blockmap 放进 UPDATE_DIR
app.use(
  '/updates',
  express.static(env.updateDir, {
    fallthrough: true,
    maxAge: '1h',
    setHeaders(res) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    },
  })
);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
