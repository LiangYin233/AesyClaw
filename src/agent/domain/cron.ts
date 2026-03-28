export interface CronSchedule {
  kind: 'once' | 'interval' | 'daily' | 'cron';
  onceAt?: string;
  intervalMs?: number;
  dailyAt?: string;
  cronExpr?: string;
  tz?: string;
}

export interface CronPayload {
  description: string;
  detail: string;
  channel?: string;
  target?: string;
}

export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: CronSchedule;
  payload: CronPayload;
  nextRunAtMs?: number;
  lastRunAtMs?: number;
}