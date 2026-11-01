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
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/me'));
app.use('/api', require('./routes/launch'));
app.use('/api', require('./routes/servers'));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
