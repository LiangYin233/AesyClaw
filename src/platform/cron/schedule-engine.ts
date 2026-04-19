export function validateExpression(expression: string): boolean {
  if (!expression || typeof expression !== 'string') return false;
  const parts = tokenize(expression);
  if (parts.length !== 5) return false;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return (
    validateField(minute, 0, 59) &&
    validateField(hour, 0, 23) &&
    validateField(dayOfMonth, 1, 31) &&
    validateField(month, 1, 12) &&
    validateDayOfWeekField(dayOfWeek)
  );
}

export function getNextRunAt(expression: string, from: Date = new Date()): string | null {
  if (!validateExpression(expression)) return null;

  const parts = tokenize(expression);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const next = new Date(from);
  next.setSeconds(0);
  next.setMilliseconds(0);
  next.setMinutes(next.getMinutes() + 1);

  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (
      matches(next.getMinutes(), minute) &&
      matches(next.getHours(), hour) &&
      matches(next.getDate(), dayOfMonth) &&
      matches(next.getMonth() + 1, month) &&
      matchesDayOfWeek(next.getDay(), dayOfWeek)
    ) {
      return next.toISOString();
    }
    next.setMinutes(next.getMinutes() + 1);
  }

  return null;
}

function matches(value: number, pattern: string): boolean {
  if (pattern === '*') return true;

  if (pattern.includes(',')) {
    return pattern.split(',').some(part => matches(value, part.trim()));
  }

  if (pattern.includes('/')) {
    const [range, stepStr] = pattern.split('/');
    const step = parseInt(stepStr, 10);
    if (isNaN(step) || step <= 0) return false;

    if (range === '*') {
      return value % step === 0;
    }
    if (range.includes('-')) {
      const [start, end] = range.split('-').map(Number);
      if (isNaN(start) || isNaN(end)) return false;
      return value >= start && value <= end && (value - start) % step === 0;
    }
    const start = parseInt(range, 10);
    if (isNaN(start)) return false;
    return value >= start && (value - start) % step === 0;
  }

  if (pattern.includes('-')) {
    const [start, end] = pattern.split('-').map(Number);
    if (isNaN(start) || isNaN(end)) return false;
    return value >= start && value <= end;
  }

  return parseInt(pattern, 10) === value;
}

function tokenize(expression: string): string[] {
  return expression.trim().split(/\s+/);
}

function validateField(pattern: string, min: number, max: number): boolean {
  if (pattern === '*') {
    return true;
  }

  if (pattern.includes(',')) {
    return pattern.split(',').every(part => validateField(part.trim(), min, max));
  }

  if (pattern.includes('/')) {
    const [range, stepStr] = pattern.split('/');
    const step = parseInt(stepStr, 10);
    if (isNaN(step) || step <= 0) {
      return false;
    }

    if (range === '*') {
      return true;
    }

    if (range.includes('-')) {
      const [start, end] = range.split('-').map(Number);
      return isValidRange(start, end, min, max);
    }

    const start = parseInt(range, 10);
    return !isNaN(start) && start >= min && start <= max;
  }

  if (pattern.includes('-')) {
    const [start, end] = pattern.split('-').map(Number);
    return isValidRange(start, end, min, max);
  }

  const value = parseInt(pattern, 10);
  return !isNaN(value) && value >= min && value <= max;
}

function validateDayOfWeekField(pattern: string): boolean {
  return validateField(pattern, 0, 7);
}

function matchesDayOfWeek(value: number, pattern: string): boolean {
  if (pattern === '*') return true;

  if (pattern.includes(',')) {
    return pattern.split(',').some(part => matchesDayOfWeek(value, part.trim()));
  }

  if (pattern.includes('/')) {
    const [range, stepStr] = pattern.split('/');
    const step = parseInt(stepStr, 10);
    if (isNaN(step) || step <= 0) return false;

    if (range === '*') {
      return normalizedDayOfWeek(value) % step === 0;
    }
    if (range.includes('-')) {
      const [start, end] = range.split('-').map(Number);
      if (isNaN(start) || isNaN(end)) return false;

      const normalizedValue = normalizedDayOfWeek(value);
      const normalizedStart = normalizedDayOfWeek(start);
      const normalizedEnd = normalizedDayOfWeek(end);
      return normalizedValue >= normalizedStart && normalizedValue <= normalizedEnd && (normalizedValue - normalizedStart) % step === 0;
    }

    const start = parseInt(range, 10);
    if (isNaN(start)) return false;
    const normalizedValue = normalizedDayOfWeek(value);
    const normalizedStart = normalizedDayOfWeek(start);
    return normalizedValue >= normalizedStart && (normalizedValue - normalizedStart) % step === 0;
  }

  if (pattern.includes('-')) {
    const [start, end] = pattern.split('-').map(Number);
    if (isNaN(start) || isNaN(end)) return false;

    const normalizedValue = normalizedDayOfWeek(value);
    const normalizedStart = normalizedDayOfWeek(start);
    const normalizedEnd = normalizedDayOfWeek(end);
    return normalizedValue >= normalizedStart && normalizedValue <= normalizedEnd;
  }

  return normalizedDayOfWeek(parseInt(pattern, 10)) === normalizedDayOfWeek(value);
}

function isValidRange(start: number, end: number, min: number, max: number): boolean {
  if (isNaN(start) || isNaN(end)) {
    return false;
  }

  return start >= min && end <= max && start <= end;
}

function normalizedDayOfWeek(value: number): number {
  return value === 7 ? 0 : value;
}
