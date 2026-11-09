function parseCronField(field: string, min: number, max: number, sunday = false): { values: Set<number>; wildcard: boolean } | null {
  const values = new Set<number>();
  const wildcard = field === "*" || field.startsWith("*/");
  for (const part of field.split(",")) {
    if (!part) return null;
    const [rangePart, stepPart, extra] = part.split("/");
    if (extra !== undefined) return null;
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1 || step > max + 1) return null;
    let start: number;
    let end: number;
    if (rangePart === "*") { start = min; end = max; }
    else if (rangePart.includes("-")) {
      const range = rangePart.split("-");
      if (range.length !== 2) return null;
      start = Number(range[0]); end = Number(range[1]);
    } else {
      start = Number(rangePart);
      end = stepPart === undefined ? start : max;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) return null;
    for (let value = start; value <= end; value += step) values.add(sunday && value === 7 ? 0 : value);
  }
  return values.size ? { values, wildcard } : null;
}

function parseCron(expression: string) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const minute = parseCronField(fields[0], 0, 59);
  const hour = parseCronField(fields[1], 0, 23);
  const day = parseCronField(fields[2], 1, 31);
  const month = parseCronField(fields[3], 1, 12);
  const weekday = parseCronField(fields[4], 0, 7, true);
  return minute && hour && day && month && weekday ? { minute, hour, day, month, weekday } : null;
}

export function isValidCronExpression(expression: string) {
  return Boolean(parseCron(expression));
}

export function matchesCronSchedule(expression: string, date: Date, timezone: string) {
  const cron = parseCron(expression);
  if (!cron) return false;
  let parts: Record<string, string>;
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, minute: "numeric", hour: "numeric", hourCycle: "h23",
      day: "numeric", month: "numeric", weekday: "short",
    }).formatToParts(date).map((part) => [part.type, part.value]));
  } catch { return false; }
  const minute = Number(parts.minute); const hour = Number(parts.hour);
  const day = Number(parts.day); const month = Number(parts.month);
  const weekday = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[parts.weekday];
  const dayMatch = cron.day.values.has(day);
  const weekdayMatch = cron.weekday.values.has(weekday);
  const calendarDayMatch = cron.day.wildcard ? weekdayMatch : cron.weekday.wildcard ? dayMatch : dayMatch || weekdayMatch;
  return cron.minute.values.has(minute) && cron.hour.values.has(hour) && cron.month.values.has(month) && calendarDayMatch;
}

