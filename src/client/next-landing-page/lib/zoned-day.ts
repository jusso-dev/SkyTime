function partsInZone(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

export function zonedMidnightUtc(day: string, timeZone: string) {
  const [year, month, date] = day.split("-").map(Number);
  let guess = Date.UTC(year, month - 1, date, 0, 0, 0);
  const want = guess;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const gotParts = partsInZone(new Date(guess), timeZone);
    const got = Date.UTC(
      gotParts.year,
      gotParts.month - 1,
      gotParts.day,
      gotParts.hour,
      gotParts.minute,
      gotParts.second,
    );
    guess -= got - want;
  }
  return new Date(guess);
}

export function nextUtcDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, date));
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export function localDate(instant: Date | string, timeZone: string) {
  const value = instant instanceof Date ? instant : new Date(instant);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}
