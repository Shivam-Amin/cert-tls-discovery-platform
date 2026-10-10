// Runs and reports.
import { Router } from 'express';
import * as store from '../db.js';
import { startRun } from '../runner.js';
import { checkParams, checkType } from '../validate.js';

export const runsRouter = Router();

// Home page: latest finished run per type, active runs, totals.
runsRouter.get('/summary', (req, res) => {
  res.json(store.getSummary());
});

// Discovery Runs table. Optional filters: ?type=tls&status=failed&limit=50
runsRouter.get('/runs', (req, res) => {
  const { type, status } = req.query;
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(store.listRuns({ type, status, limit }));
});

// Start a scan: { "type": "filesystem", "params": { "roots": ["/etc/ssl"] } }
//               { "type": "tls", "params": { "duration_seconds": 30 } }
// Responds 202 with the queued run; poll GET /runs/:id for progress.
runsRouter.post('/runs', (req, res) => {
  const type = checkType(req.body?.type);
  if (type.error) return res.status(400).json({ error: type.error });
  const params = checkParams(type.value, req.body?.params);
  if (params.error) return res.status(400).json({ error: params.error });

  res.status(202).json(startRun(type.value, 'manual', params.value));
});

// Loads the run for every /runs/:id/... route, or answers 404.
runsRouter.param('id', (req, res, next, id) => {
  const run = store.getRun(Number(id));
  if (!run) return res.status(404).json({ error: `run ${id} not found` });
  req.run = run;
  next();
});

runsRouter.get('/runs/:id', (req, res) => res.json(req.run));

runsRouter.get('/runs/:id/certificates', (req, res) => {
  res.json(store.getCertificates(req.run.id));
});

runsRouter.get('/runs/:id/tls', (req, res) => {
  res.json(store.getTlsObservations(req.run.id));
});

runsRouter.get('/runs/:id/relationships', (req, res) => {
  res.json(store.getRelationships(req.run.id));
});
