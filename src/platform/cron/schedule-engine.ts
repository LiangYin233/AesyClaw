export type CronSchedule =
  | { type: 'once' }
  | { type: 'daily'; hour: number; minute: number }
  | { type: 'interval'; intervalMinutes: number };

export type CreateCronScheduleInput =
  | { type: 'once'; runAt: string }
  | { type: 'delay'; delayMinutes: number }
  | { type: 'daily'; dailyTime: string }
  | { type: 'interval'; intervalMinutes: number };

type SchedulePayload = Record<string, unknown>;

export function parseDailyTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return { hour, minute };
}

export function serializeSchedule(schedule: CronSchedule): { scheduleType: string; scheduleData: string } {
  return {
    scheduleType: schedule.type,
    scheduleData: JSON.stringify(toSchedulePayload(schedule)),
  };
}

export function parseSchedule(scheduleType: string | null | undefined, scheduleData: string | null | undefined): CronSchedule | null {
  if (scheduleType === 'once') {
    return { type: 'once' };
  }

  const payload = parseSchedulePayload(scheduleData);
  if (!payload) {
    return null;
  }

  if (scheduleType === 'daily') {
    const hour = getInteger(payload.hour);
    const minute = getInteger(payload.minute);
    if (hour === null || minute === null) {
      return null;
    }
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }

    return { type: 'daily', hour, minute };
  }

  if (scheduleType === 'interval') {
    const intervalMinutes = getInteger(payload.intervalMinutes);
    if (intervalMinutes === null || intervalMinutes <= 0) {
      return null;
    }

    return { type: 'interval', intervalMinutes };
  }

  return null;
}

export function getNextDailyRunAt(hour: number, minute: number, from: Date): string {
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);

  if (next.getTime() <= from.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next.toISOString();
}

export function getNextFutureRunAt(
  schedule: CronSchedule,
  from: Date,
  currentNextRunAt?: string | null
): string | null {
  if (schedule.type === 'once') {
    return null;
  }

  if (schedule.type === 'daily') {
    return getNextDailyRunAt(schedule.hour, schedule.minute, from);
  }

  const intervalMs = schedule.intervalMinutes * 60_000;
  let next = parseRunAt(currentNextRunAt) ?? new Date(from);

  while (next.getTime() <= from.getTime()) {
    next = new Date(next.getTime() + intervalMs);
  }

  return next.toISOString();
}

export function normalizeScheduleInput(
  input: CreateCronScheduleInput,
  from: Date = new Date()
): { schedule: CronSchedule; nextRunAt: string } {
  if (input.type === 'once') {
    return {
      schedule: { type: 'once' },
      nextRunAt: parseFutureRunAt(input.runAt, from),
    };
  }

  if (input.type === 'delay') {
    if (!Number.isInteger(input.delayMinutes) || input.delayMinutes <= 0) {
      throw new Error('delayMinutes must be a positive integer');
    }

    return {
      schedule: { type: 'once' },
      nextRunAt: new Date(from.getTime() + input.delayMinutes * 60_000).toISOString(),
    };
  }

  if (input.type === 'daily') {
    const parsed = parseDailyTime(input.dailyTime);
    if (!parsed) {
      throw new Error(`Invalid daily time: ${input.dailyTime}`);
    }

    return {
      schedule: { type: 'daily', hour: parsed.hour, minute: parsed.minute },
      nextRunAt: getNextDailyRunAt(parsed.hour, parsed.minute, from),
    };
  }

  if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes <= 0) {
    throw new Error('intervalMinutes must be a positive integer');
  }

  const schedule: CronSchedule = {
    type: 'interval',
    intervalMinutes: input.intervalMinutes,
  };

  return {
    schedule,
    nextRunAt: getNextFutureRunAt(schedule, from)!,
  };
}

function toSchedulePayload(schedule: CronSchedule): SchedulePayload {
  if (schedule.type === 'once') {
    return {};
  }

  if (schedule.type === 'daily') {
    return {
      hour: schedule.hour,
      minute: schedule.minute,
    };
  }

  return {
    intervalMinutes: schedule.intervalMinutes,
  };
}

function parseSchedulePayload(scheduleData: string | null | undefined): SchedulePayload | null {
  if (!scheduleData) {
    return {};
  }

  try {
    const parsed = JSON.parse(scheduleData) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return parsed as SchedulePayload;
  } catch {
    return null;
  }
}

function parseRunAt(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function parseFutureRunAt(value: string, from: Date): string {
  const runAt = parseRunAt(value);
  if (!runAt) {
    throw new Error(`Invalid runAt value: ${value}`);
  }

  if (runAt.getTime() <= from.getTime()) {
    throw new Error('runAt must be in the future');
  }

  return runAt.toISOString();
}

function getInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return null;
  }

  return value;
}
