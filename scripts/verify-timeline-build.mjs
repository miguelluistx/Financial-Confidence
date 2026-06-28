/** Simulates legacy recurring paycheck data + timeline build path */

function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysToISO(daysFromToday) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + daysFromToday);
  return toISODate(date);
}

function advanceRecurringPaycheckDate(date, frequency, anchorDay) {
  if (frequency === "Weekly") {
    date.setDate(date.getDate() + 7);
    return;
  }
  if (frequency === "Biweekly") {
    date.setDate(date.getDate() + 14);
    return;
  }
  date.setMonth(date.getMonth() + 1);
  const daysInMonth = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0,
  ).getDate();
  date.setDate(Math.min(anchorDay, daysInMonth));
}

function normalizeRecurringPaycheck(paycheck) {
  const firstPayDate =
    paycheck.firstPayDate?.trim() ||
    paycheck.payDate?.trim() ||
    paycheck.firstPaycheckDate?.trim() ||
    "";
  const futurePaycheckCount =
    typeof paycheck.futurePaycheckCount === "number"
      ? paycheck.futurePaycheckCount
      : Number(paycheck.futurePaycheckCount) || 6;
  return { ...paycheck, firstPayDate, futurePaycheckCount };
}

function normalizeRecurringPaychecks(paychecks) {
  if (!Array.isArray(paychecks)) return [];
  return paychecks.map((paycheck) => normalizeRecurringPaycheck(paycheck));
}

function mergePersistedRecurringPaychecks(saved) {
  const raw = saved.recurringPaychecks;
  if (!Array.isArray(raw)) return [];
  const fallbackFirstDate = saved.recurringPaycheckFirstPayDate?.trim() ?? "";
  return raw.map((paycheck) =>
    normalizeRecurringPaycheck({
      ...paycheck,
      firstPayDate:
        paycheck.firstPayDate?.trim() ||
        paycheck.payDate?.trim() ||
        paycheck.firstPaycheckDate?.trim() ||
        fallbackFirstDate ||
        "",
    }),
  );
}

function resolveTimelineRecurringPaychecks(paychecks, fallbackFirstPayDate = "") {
  const fallback = fallbackFirstPayDate.trim();
  return normalizeRecurringPaychecks(paychecks).map((paycheck) => ({
    ...paycheck,
    firstPayDate: paycheck.firstPayDate || fallback,
  }));
}

function getRecurringPaycheckOccurrencesInRange(paycheck, start, end) {
  if (!paycheck.firstPayDate?.trim()) return [];
  const dates = [];
  const startDay = new Date(start);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(23, 59, 59, 999);
  const [year, month, day] = paycheck.firstPayDate.split("-").map(Number);
  const occurrence = new Date(year, month - 1, day);
  occurrence.setHours(0, 0, 0, 0);
  while (occurrence < startDay) {
    advanceRecurringPaycheckDate(occurrence, paycheck.frequency, day);
  }
  let iterations = 0;
  while (occurrence <= endDay && iterations < 200) {
    iterations++;
    dates.push(toISODate(occurrence));
    advanceRecurringPaycheckDate(occurrence, paycheck.frequency, day);
  }
  return dates;
}

function buildRecurringPaycheckTimelineEvents(recurringPaychecks, today, horizonEnd) {
  return recurringPaychecks.flatMap((paycheck) =>
    getRecurringPaycheckOccurrencesInRange(paycheck, today, horizonEnd)
      .filter((date) => !paycheck.skippedDates?.includes(date))
      .map((date) => ({
        id: `recurring-paycheck-${paycheck.id}-${date}`,
        name: paycheck.name,
        amount: paycheck.amount,
        date,
        type: "Income",
      })),
  );
}

function filterTimelineEventsByRange(events, rangeEnd) {
  const todayISO = toISODate(new Date());
  const rangeEndISO = toISODate(rangeEnd);
  return events.filter(
    (event) => event.date >= todayISO && event.date <= rangeEndISO,
  );
}

// Legacy persisted shape: firstPayDate only in form field, not on paycheck object
const legacySaved = {
  recurringPaycheckFirstPayDate: addDaysToISO(5),
  recurringPaychecks: [
    {
      id: "demo-paycheck-rec",
      name: "Biweekly Pay",
      amount: 1850,
      frequency: "Biweekly",
      futurePaycheckCount: 6,
    },
  ],
};

const statePaychecks = mergePersistedRecurringPaychecks(legacySaved);
const timelinePaychecks = resolveTimelineRecurringPaychecks(
  statePaychecks,
  legacySaved.recurringPaycheckFirstPayDate,
);

const today = new Date();
today.setHours(0, 0, 0, 0);
const horizonEnd = new Date(today);
horizonEnd.setDate(horizonEnd.getDate() + 120);
horizonEnd.setHours(23, 59, 59, 999);

const incomeEvents = buildRecurringPaycheckTimelineEvents(
  timelinePaychecks,
  today,
  horizonEnd,
);
const monthEnd = new Date(
  today.getFullYear(),
  today.getMonth() + 1,
  0,
  23,
  59,
  59,
  999,
);
const viewEvents = filterTimelineEventsByRange(incomeEvents, monthEnd);

console.log({
  stateFirstPayDate: statePaychecks[0]?.firstPayDate,
  timelineFirstPayDate: timelinePaychecks[0]?.firstPayDate,
  generatedIncomeEvents: incomeEvents.length,
  thisMonthView: viewEvents.length,
});

if (incomeEvents.length === 0) {
  console.error("FAIL: legacy paycheck data produced zero income events");
  process.exit(1);
}

console.log("PASS: legacy paycheck data generates income events");
