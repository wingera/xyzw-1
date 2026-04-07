export const ONE_DAY_ACTIVATION_DURATION_MONTHS = 0;
export const ALLOWED_ACTIVATION_DURATION_MONTHS = Object.freeze([
  ONE_DAY_ACTIVATION_DURATION_MONTHS,
  1,
  3,
  6,
  12,
]);

const allowedActivationDurationMonthSet = new Set(ALLOWED_ACTIVATION_DURATION_MONTHS);

const toIntegerOrNull = (value) => {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    return null;
  }
  return numeric;
};

export const normalizeActivationDurationMonths = (value, fallback = 1) => {
  const parsed = toIntegerOrNull(value);
  if (parsed === ONE_DAY_ACTIVATION_DURATION_MONTHS) {
    return ONE_DAY_ACTIVATION_DURATION_MONTHS;
  }
  if (parsed === null) {
    return fallback;
  }
  return Math.max(1, Math.min(24, parsed));
};

export const isAllowedActivationDurationMonths = (value) => {
  const parsed = toIntegerOrNull(value);
  return parsed !== null && allowedActivationDurationMonthSet.has(parsed);
};

export const isOneDayActivationDuration = (value) =>
  toIntegerOrNull(value) === ONE_DAY_ACTIVATION_DURATION_MONTHS;

const addMonths = (baseDate, months) => {
  const date = new Date(baseDate);
  const day = date.getDate();
  date.setMonth(date.getMonth() + months);
  if (date.getDate() < day) {
    date.setDate(0);
  }
  return date;
};

const addDays = (baseDate, days) => {
  const date = new Date(baseDate);
  date.setDate(date.getDate() + days);
  return date;
};

export const addActivationDuration = (baseDate, durationMonths) => {
  if (isOneDayActivationDuration(durationMonths)) {
    return addDays(baseDate, 1);
  }
  return addMonths(baseDate, normalizeActivationDurationMonths(durationMonths));
};
