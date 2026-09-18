const TAIWAN_TIME_ZONE = "Asia/Taipei";
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

function isValidParts(parts: DateParts): boolean {
  return (
    parts.year >= 1970 &&
    parts.year <= 2200 &&
    parts.month >= 1 &&
    parts.month <= 12 &&
    parts.day >= 1 &&
    parts.day <= 31 &&
    parts.hour >= 0 &&
    parts.hour <= 23 &&
    parts.minute >= 0 &&
    parts.minute <= 59 &&
    parts.second >= 0 &&
    parts.second <= 59 &&
    parts.millisecond >= 0 &&
    parts.millisecond <= 999
  );
}

function taiwanParts(date: Date): DateParts {
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone: TAIWAN_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  })
    .formatToParts(date)
    .reduce<Record<string, number>>((parts, part) => {
      if (part.type !== "literal") parts[part.type] = Number(part.value);
      return parts;
    }, {});

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour === 24 ? 0 : values.hour,
    minute: values.minute,
    second: values.second,
    millisecond: date.getUTCMilliseconds(),
  };
}

function dateFromTaiwanParts(parts: DateParts): Date | null {
  if (!isValidParts(parts)) return null;
  const date = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour - 8,
      parts.minute,
      parts.second,
      parts.millisecond,
    ),
  );
  const parsed = taiwanParts(date);
  return Object.keys(parts).every((key) => parsed[key as keyof DateParts] === parts[key as keyof DateParts])
    ? date
    : null;
}

function parseLegacyPttDate(value: string): Date | null {
  const match = value.match(
    /^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(\d{4})$/i,
  );
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return null;
  return dateFromTaiwanParts({
    year: Number(match[6]),
    month,
    day: Number(match[2]),
    hour: Number(match[3]),
    minute: Number(match[4]),
    second: Number(match[5] ?? 0),
    millisecond: 0,
  });
}

function parseIsoDate(value: string): Date | null {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/,
  );
  if (!match) return null;

  const hasTime = match[4] !== undefined;
  const zone = match[8];
  if (hasTime && zone) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return dateFromTaiwanParts({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
    millisecond: Number((match[7] ?? "").padEnd(3, "0") || 0),
  });
}

function parseUrlEpoch(url: string): Date | null {
  const match = url.match(/(?:^|\/)M\.(\d{9,13})(?:[./]|$)/i);
  if (!match) return null;
  const raw = Number(match[1]);
  const timestamp = match[1].length >= 13 ? raw : raw * 1000;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2200
    ? null
    : date;
}

/** Parse article timestamps without relying on the server or browser locale. */
export function parseArticleDate(value: string | undefined, url = ""): Date | null {
  const normalized = value?.trim() ?? "";
  return parseLegacyPttDate(normalized) ?? parseIsoDate(normalized) ?? parseUrlEpoch(url);
}

export function articleTimestamp(value: string | undefined, url = ""): number | null {
  return parseArticleDate(value, url)?.getTime() ?? null;
}

export function formatArticleTimeTaiwan(value: string | undefined, url: string, fallback = ""): string {
  const date = parseArticleDate(value, url);
  if (!date) return fallback || "日期未知";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: TAIWAN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Return an Excel serial for Taiwan local wall-clock time, independent of host TZ. */
export function articleExcelSerial(value: string | undefined, url = ""): number | null {
  const date = parseArticleDate(value, url);
  if (!date) return null;
  const parts = taiwanParts(date);
  const taiwanWallClockUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  return (taiwanWallClockUtc - EXCEL_EPOCH_UTC_MS) / DAY_MS;
}
