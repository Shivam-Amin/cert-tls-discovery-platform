// Entry point: HTTP API + scheduler + (when built) the web UI.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { failInterruptedRuns } from './db.js';
import { runsRouter } from './routes/runs.js';
import { schedulesRouter } from './routes/schedules.js';
import { startScheduler } from './scheduler.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    agent_found: fs.existsSync(config.agentPath),
    running_as_root: process.getuid?.() === 0,
  });
});
app.use('/api', runsRouter);
app.use('/api', schedulesRouter);
app.use('/api', (req, res) => res.status(404).json({ error: `no API route ${req.method} ${req.path}` }));

// Serve the built React app (frontend/dist) if it exists.
// Any non-API GET returns index.html so browser routes like /runs/7 work.
if (fs.existsSync(config.frontendDist)) {
  app.use(express.static(config.frontendDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(config.frontendDist, 'index.html'));
  });
}

// Errors thrown in routes (and bad JSON bodies) end up here as JSON.
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'internal server error' : err.message });
});

// ---- start ----
const interrupted = failInterruptedRuns();
if (interrupted > 0) console.log(`marked ${interrupted} unfinished run(s) from last time as failed`);

if (!fs.existsSync(config.agentPath)) {
  console.warn(`WARNING: agent not found at ${config.agentPath}; build it or set AGENT_PATH`);
}
if (process.getuid?.() !== 0) {
  console.warn('WARNING: not running as root; TLS scans will fail. Start with: sudo npm start');
}

startScheduler();
app.listen(config.port, config.host, () => {
  console.log(`backend listening on http://${config.host}:${config.port}`);
  console.log(`database: ${config.dbPath}`);
  console.log(`agent:    ${config.agentPath}`);
});
