// Periodic scan settings (one schedule per scan type).
import { Router } from 'express';
import * as store from '../db.js';
import { checkSchedule, checkType } from '../validate.js';

export const schedulesRouter = Router();

schedulesRouter.get('/schedules', (req, res) => {
  res.json(store.getSchedules());
});

// Body (all optional): { "enabled": true, "interval_minutes": 10, "params": {...} }
schedulesRouter.put('/schedules/:type', (req, res) => {
  const type = checkType(req.params.type);
  if (type.error) return res.status(400).json({ error: type.error });

  const current = store.getSchedule(type.value);
  const schedule = checkSchedule(type.value, req.body ?? {}, current);
  if (schedule.error) return res.status(400).json({ error: schedule.error });

  res.json(store.updateSchedule(type.value, schedule.value));
});
