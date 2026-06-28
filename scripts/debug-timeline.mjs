/** Full timeline build simulation using demo data shape */

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
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
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
  return paychecks.map(normalizeRecurringPaycheck).filter((p) => p.firstPayDate !== "");
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

function filterOutCompletedTimelineEvents(events, completedEvents) {
  if (completedEvents.length === 0) return events;
  const completedSourceEventIds = new Set(completedEvents.map((entry) => entry.sourceEventId));
  return events.filter((event) => !completedSourceEventIds.has(event.id));
}

function filterTimelineEventsByRange(events, rangeEnd) {
  const todayISO = toISODate(new Date());
  const rangeEndISO = toISODate(rangeEnd);
  return events.filter((event) => event.date >= todayISO && event.date <= rangeEndISO);
}

const recurringPaychecks = normalizeRecurringPaychecks([
  {
    id: "demo-paycheck-rec",
    name: "Biweekly Pay",
    amount: 1850,
    frequency: "Biweekly",
    firstPayDate: addDaysToISO(5),
    futurePaycheckCount: 6,
  },
]);

const today = new Date();
today.setHours(0, 0, 0, 0);
const horizonEnd = new Date(today);
horizonEnd.setDate(horizonEnd.getDate() + 120);

const incomeEvents = buildRecurringPaycheckTimelineEvents(recurringPaychecks, today, horizonEnd);
const filtered = filterOutCompletedTimelineEvents(incomeEvents, []);
const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
const viewEvents = filterTimelineEventsByRange(filtered, monthEnd);

console.log({
  recurringPaychecks: recurringPaychecks.length,
  generatedIncomeEvents: incomeEvents.length,
  afterCompletedFilter: filtered.length,
  thisMonthView: viewEvents.length,
  sampleIncome: incomeEvents.slice(0, 3),
});

if (incomeEvents.length === 0) {
  process.exit(1);
}
