const pad = (n) => String(n).padStart(2, '0');

/** Fecha local en formato YYYY-MM-DD. */
function toIsoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Fecha y hora local en formato YYYY-MM-DD HH:MM:SS. */
function toIsoDateTime(date) {
  return `${toIsoDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseIsoDate(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return toIsoDate(parseIsoDate(value)) === value;
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Último día hábil (lunes a viernes) en o antes de la fecha dada. */
function lastWeekday(date) {
  let current = new Date(date);
  while (isWeekend(current)) current = addDays(current, -1);
  return current;
}

function weekdaysBetween(startIso, endIso) {
  const days = [];
  for (let d = parseIsoDate(startIso); toIsoDate(d) <= endIso; d = addDays(d, 1)) {
    if (!isWeekend(d)) days.push(toIsoDate(d));
  }
  return days;
}

/** "Apellidos, Nombres" */
function fullName(student) {
  return `${student.last_names}, ${student.first_names}`;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/** Promedio de un curso: media de las competencias redondeada (escala vigesimal). */
function courseGrade(row) {
  const values = [row.c1, row.c2, row.c3, row.c4];
  if (values.some((v) => v === null || v === undefined)) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / 4);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = {
  toIsoDate,
  toIsoDateTime,
  parseIsoDate,
  isValidIsoDate,
  isWeekend,
  addDays,
  lastWeekday,
  weekdaysBetween,
  fullName,
  round1,
  courseGrade,
  HttpError,
};
