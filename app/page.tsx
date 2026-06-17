"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type PlannedBill = {
  id: string;
  name: string;
  amount: number;
  dueDate: string;
};

type RecurringFrequency = "Monthly" | "Weekly" | "Biweekly";

type SpendingVerdict =
  | "Affordable Now"
  | "Wait Until Payday"
  | "Not Affordable Today"
  | "Not Affordable";

type PurchaseType =
  | "One-Time Purchase"
  | "Monthly Subscription"
  | "Weekly Habit";

type SpendingDecisionResult = {
  verdict: SpendingVerdict;
  purchaseName: string;
  cost: number;
  purchaseType: PurchaseType;
  monthlyImpact: number;
  purchaseCost: number;
  currentSafeToSpend: number;
  availableByPurchaseDate: number;
  remainingSafeToSpend: number;
  projectedBalance: number;
  projectedShortfall: number | null;
  evaluationDate: string;
  usedTodayForAnalysisOnly: boolean;
  explanation: string;
  monthlyEquivalentLabel: string | null;
};

type UserProfile = {
  name: string;
  email: string;
};

const DEFAULT_PROFILE: UserProfile = {
  name: "",
  email: "",
};

function normalizePurchaseType(value: string | undefined): PurchaseType {
  switch (value) {
    case "One-Time Purchase":
    case "Monthly Subscription":
    case "Weekly Habit":
      return value;
    case "One-Time":
      return "One-Time Purchase";
    case "Monthly":
      return "Monthly Subscription";
    case "Weekly":
    case "Daily":
      return "Weekly Habit";
    default:
      return "One-Time Purchase";
  }
}

function getSpendingDecisionMonthlyImpact(
  cost: number,
  purchaseType: PurchaseType,
): number {
  switch (purchaseType) {
    case "One-Time Purchase":
      return cost;
    case "Monthly Subscription":
      return cost;
    case "Weekly Habit":
      return cost * 4;
  }
}

function getWeeklyHabitMonthlyEquivalentLabel(cost: number): string {
  const monthlyEquivalent = cost * 4;
  return `$${cost}/week × 4 weeks = $${monthlyEquivalent}/month`;
}

function isPlannedPurchaseEvent(eventId: string): boolean {
  return eventId.startsWith("planned-purchase-");
}

function getVerdictDisplayLabel(verdict: SpendingVerdict): string {
  switch (verdict) {
    case "Affordable Now":
      return "✅ AFFORDABLE NOW";
    case "Wait Until Payday":
      return "🟡 WAIT UNTIL PAYDAY";
    case "Not Affordable Today":
      return "🔴 NOT AFFORDABLE TODAY";
    case "Not Affordable":
      return "❌ NOT AFFORDABLE";
  }
}

function getBalanceBeforeDate(
  checkingBalance: number,
  events: TimelineEvent[],
  targetDate: string,
): number {
  let balance = checkingBalance;

  for (const event of sortTimelineEvents(events)) {
    if (event.date >= targetDate) break;

    if (event.type === "Expense") {
      balance -= event.amount;
    } else {
      balance += event.amount;
    }
  }

  return Math.round(balance * 100) / 100;
}

function getFinancialProjectionBeforeNextIncome(
  checkingBalance: number,
  events: TimelineEvent[],
  extraEvents: TimelineEvent[] = [],
  fromDate?: string,
): { hasShortfall: boolean; lowestBalance: number } {
  const sorted = sortTimelineEvents([...events, ...extraEvents]);
  const startDate = fromDate ?? toISODate(new Date());

  let runningBalance = checkingBalance;
  let lowestBalance = runningBalance;
  let hasShortfall = false;

  for (const event of sorted) {
    if (event.date < startDate) {
      if (event.type === "Expense") {
        runningBalance -= event.amount;
      } else {
        runningBalance += event.amount;
      }
      continue;
    }

    if (event.type === "Income") {
      break;
    }

    if (runningBalance < event.amount) {
      hasShortfall = true;
    }

    runningBalance -= event.amount;
    lowestBalance = Math.min(lowestBalance, runningBalance);
  }

  return {
    hasShortfall: hasShortfall || lowestBalance < 0,
    lowestBalance: Math.round(lowestBalance * 100) / 100,
  };
}

function projectFutureBalance(
  checkingBalance: number,
  baseEvents: TimelineEvent[],
  purchaseImpact: number,
  purchaseDate: string,
): { endingBalance: number; hasShortfall: boolean; lowestBalance: number } {
  const purchaseEvent: TimelineEvent = {
    id: "simulated-purchase",
    name: "Simulated Purchase",
    amount: purchaseImpact,
    date: purchaseDate,
    type: "Expense",
  };

  const result = runFinancialCalculation(
    checkingBalance,
    baseEvents,
    [purchaseEvent],
  );

  return {
    endingBalance: result.endingBalance,
    hasShortfall: result.hasShortfall,
    lowestBalance: result.lowestBalance,
  };
}

function evaluateSpendingDecision(
  purchaseName: string,
  cost: number,
  purchaseType: PurchaseType,
  safeToSpend: number,
  checkingBalance: number,
  timelineEvents: TimelineEvent[],
  purchaseDateInput: string,
): SpendingDecisionResult {
  const purchaseCost = getSpendingDecisionMonthlyImpact(cost, purchaseType);
  const usedTodayForAnalysisOnly = purchaseDateInput.trim() === "";
  const evaluationDate = usedTodayForAnalysisOnly
    ? toISODate(new Date())
    : purchaseDateInput.trim();
  const todayISO = toISODate(new Date());
  const isPurchaseToday = evaluationDate === todayISO;
  const purchaseEvent: TimelineEvent = {
    id: "simulated-purchase",
    name: purchaseName.trim() || "Simulated Purchase",
    amount: purchaseCost,
    date: evaluationDate,
    type: "Expense",
  };
  const beforeNextIncome = getFinancialProjectionBeforeNextIncome(
    checkingBalance,
    timelineEvents,
    [purchaseEvent],
    evaluationDate,
  );
  const fullSimulation = runFinancialCalculation(
    checkingBalance,
    timelineEvents,
    [purchaseEvent],
  );
  const projectedBalance = fullSimulation.endingBalance;
  const balanceAvailableForPurchase = isPurchaseToday
    ? checkingBalance
    : getBalanceBeforeDate(checkingBalance, timelineEvents, evaluationDate);
  const canCoverPurchaseToday = balanceAvailableForPurchase >= purchaseCost;
  const safeBeforeNextPaycheck =
    !beforeNextIncome.hasShortfall && beforeNextIncome.lowestBalance >= 0;
  const shortBy =
    Math.round(Math.max(0, purchaseCost - balanceAvailableForPurchase) * 100) /
    100;
  const nextIncomeDate = getNextIncomeDate(timelineEvents, evaluationDate);
  const isBeforeNextPaycheck =
    nextIncomeDate !== null && evaluationDate <= nextIncomeDate;

  let verdict: SpendingVerdict;
  let explanation: string;
  let projectedShortfall: number | null = null;
  let remainingSafeToSpend: number;

  if (isPurchaseToday && purchaseCost > checkingBalance) {
    verdict = "Not Affordable Today";
    remainingSafeToSpend = 0;
    projectedShortfall = Math.abs(Math.min(0, beforeNextIncome.lowestBalance));
    explanation = `You're short by $${shortBy} for this purchase.\n\nBuying this today would create a shortfall before your next paycheck.`;
  } else if (canCoverPurchaseToday && safeBeforeNextPaycheck) {
    verdict = "Affordable Now";
    remainingSafeToSpend = Math.max(0, safeToSpend - purchaseCost);
    explanation =
      "This purchase fits your cash flow and keeps your balance above $0.";
  } else if (!fullSimulation.hasShortfall && projectedBalance >= 0) {
    verdict = "Wait Until Payday";
    remainingSafeToSpend = projectedBalance;
    explanation = `You're short by $${shortBy} for this purchase.\n\nAfter your upcoming paycheck and bills, you would have about $${projectedBalance} left. Waiting until payday is recommended.`;
  } else {
    verdict = "Not Affordable";
    projectedShortfall = Math.abs(Math.min(0, fullSimulation.lowestBalance));
    remainingSafeToSpend = 0;
    const timelineShort = projectedShortfall ?? shortBy;
    if (isBeforeNextPaycheck) {
      explanation = `You're short by $${shortBy} for this purchase.\n\nBuying this today would create a shortfall before your next paycheck.`;
    } else {
      explanation = `You're short by $${shortBy} for this purchase.\n\nEven after upcoming income, this purchase is still $${timelineShort} short.`;
    }
  }

  return {
    verdict,
    purchaseName,
    cost,
    purchaseType,
    monthlyImpact: purchaseCost,
    purchaseCost,
    currentSafeToSpend: safeToSpend,
    availableByPurchaseDate: balanceAvailableForPurchase,
    remainingSafeToSpend,
    projectedBalance,
    projectedShortfall,
    evaluationDate,
    usedTodayForAnalysisOnly,
    explanation,
    monthlyEquivalentLabel:
      purchaseType === "Weekly Habit"
        ? getWeeklyHabitMonthlyEquivalentLabel(cost)
        : null,
  };
}

function normalizeSpendingDecisionResult(
  result:
    | SpendingDecisionResult
    | (Omit<SpendingDecisionResult, "verdict" | "purchaseType"> & {
        verdict?: string;
        frequency?: string;
        purchaseType?: string;
        currentSafeToSpend?: number;
        monthlyEquivalentLabel?: string | null;
      })
    | null,
): SpendingDecisionResult | null {
  if (!result) return null;

  let verdict: SpendingVerdict;
  switch (result.verdict) {
    case "Affordable Now":
    case "Wait Until Payday":
    case "Not Affordable Today":
    case "Not Affordable":
      verdict = result.verdict;
      break;
    case "Can Afford":
    case "Affordable":
      verdict = "Affordable Now";
      break;
    case "Caution":
    case "Risky":
      verdict = "Affordable Now";
      break;
    case "Wait For Paycheck":
    case "WAIT FOR PAYCHECK":
      verdict = "Wait Until Payday";
      break;
    case "Cannot Afford":
      verdict = "Not Affordable";
      break;
    default:
      verdict = "Not Affordable";
  }

  const legacyResult = result as {
    purchaseType?: string;
    frequency?: string;
  };
  const purchaseType = normalizePurchaseType(
    legacyResult.purchaseType ?? legacyResult.frequency,
  );

  return {
    verdict,
    purchaseName: result.purchaseName,
    cost: result.cost,
    purchaseType,
    monthlyImpact: result.monthlyImpact ?? result.purchaseCost ?? result.cost,
    purchaseCost:
      result.purchaseCost ?? result.monthlyImpact ?? result.cost,
    currentSafeToSpend: result.currentSafeToSpend ?? 0,
    availableByPurchaseDate:
      result.availableByPurchaseDate ?? result.currentSafeToSpend ?? 0,
    remainingSafeToSpend: result.remainingSafeToSpend,
    projectedBalance: result.projectedBalance ?? result.remainingSafeToSpend,
    projectedShortfall: result.projectedShortfall ?? null,
    evaluationDate: result.evaluationDate ?? toISODate(new Date()),
    usedTodayForAnalysisOnly: result.usedTodayForAnalysisOnly ?? false,
    explanation:
      result.explanation ||
      "Even after upcoming income, this purchase would create a cash shortfall and should be avoided for now.",
    monthlyEquivalentLabel:
      result.monthlyEquivalentLabel ??
      (purchaseType === "Weekly Habit"
        ? getWeeklyHabitMonthlyEquivalentLabel(result.cost)
        : null),
  };
}

type RecurringBill = {
  id: string;
  name: string;
  amount: number;
  dueDay: number;
  frequency: RecurringFrequency;
};

type PlannedPaycheck = {
  id: string;
  name: string;
  amount: number;
  payDate: string;
};

type TimelineEventType = "Income" | "Expense";

type TimelineEvent = {
  id: string;
  name: string;
  amount: number;
  date: string;
  type: TimelineEventType;
};

type CashFlowStatus = "risk" | "low" | "healthy";

type ShortfallCause = "purchase" | "bill_before_paycheck" | null;

type FinancialTimelineResult = {
  startingBalance: number;
  lowestBalance: number;
  lowestBalanceBeforeNextPaycheck: number;
  endingBalance: number;
  safeToSpend: number;
  hasShortfall: boolean;
  shortfallCause: ShortfallCause;
  status: CashFlowStatus;
  rows: { event: TimelineEvent; runningBalance: number }[];
};

function runFinancialCalculation(
  checkingBalance: number,
  events: TimelineEvent[],
  extraEvents: TimelineEvent[] = [],
): FinancialTimelineResult {
  const sorted = sortTimelineEvents([...events, ...extraEvents]);
  const todayISO = toISODate(new Date());

  let runningBalance = checkingBalance;
  let hasShortfall = false;
  let shortfallCause: ShortfallCause = null;
  let lowestAfterEvents = Number.POSITIVE_INFINITY;
  let lowestBeforeNextPaycheck = checkingBalance;
  let trackingBeforeNextPaycheck = true;
  const rows: FinancialTimelineResult["rows"] = [];

  for (const event of sorted) {
    if (event.type === "Expense") {
      if (runningBalance < event.amount) {
        hasShortfall = true;
        if (!shortfallCause) {
          shortfallCause = isPlannedPurchaseEvent(event.id)
            ? "purchase"
            : "bill_before_paycheck";
        }
      }
      runningBalance -= event.amount;
    } else {
      if (event.date >= todayISO && trackingBeforeNextPaycheck) {
        trackingBeforeNextPaycheck = false;
      }
      runningBalance += event.amount;
    }

    if (trackingBeforeNextPaycheck && event.date >= todayISO) {
      lowestBeforeNextPaycheck = Math.min(
        lowestBeforeNextPaycheck,
        runningBalance,
      );
    }

    lowestAfterEvents = Math.min(lowestAfterEvents, runningBalance);
    rows.push({ event, runningBalance });
  }

  if (lowestAfterEvents === Number.POSITIVE_INFINITY) {
    lowestAfterEvents = checkingBalance;
  }

  const endingBalance = Math.round(runningBalance * 100) / 100;
  const lowestBalance = Math.round(lowestAfterEvents * 100) / 100;
  const lowestBalanceBeforeNextPaycheck =
    Math.round(lowestBeforeNextPaycheck * 100) / 100;

  if (hasShortfall || lowestBalance < 0) {
    return {
      startingBalance: checkingBalance,
      lowestBalance,
      lowestBalanceBeforeNextPaycheck,
      endingBalance,
      safeToSpend: 0,
      hasShortfall: true,
      shortfallCause,
      status: "risk",
      rows,
    };
  }

  const safeToSpend = Math.max(0, lowestBalance);

  return {
    startingBalance: checkingBalance,
    lowestBalance,
    lowestBalanceBeforeNextPaycheck,
    endingBalance,
    safeToSpend,
    hasShortfall: false,
    shortfallCause: null,
    status: getCashFlowStatus(safeToSpend),
    rows,
  };
}

function getNextUpcomingPaycheck(
  paychecks: PlannedPaycheck[],
): PlannedPaycheck | null {
  const today = toISODate(new Date());
  const upcoming = [...paychecks]
    .filter((paycheck) => paycheck.payDate >= today)
    .sort((a, b) => a.payDate.localeCompare(b.payDate));
  return upcoming[0] ?? null;
}

function getSafeToSpendHorizonEnd(plannedPaychecks: PlannedPaycheck[]): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const horizonEnd = new Date(today);
  horizonEnd.setDate(horizonEnd.getDate() + 30);

  const nextPaycheck = getNextUpcomingPaycheck(plannedPaychecks);
  if (nextPaycheck) {
    const [year, month, day] = nextPaycheck.payDate.split("-").map(Number);
    const paycheckDate = new Date(year, month - 1, day);
    if (paycheckDate > horizonEnd) {
      horizonEnd.setTime(paycheckDate.getTime());
    }
  }

  return horizonEnd;
}

function sortTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    if (a.type === b.type) return 0;
    return a.type === "Expense" ? -1 : 1;
  });
}

function buildFinancialTimelineEvents(
  plannedBills: PlannedBill[],
  recurringBills: RecurringBill[],
  plannedPaychecks: PlannedPaycheck[],
  timelineEvents: TimelineEvent[],
  horizonEnd: Date,
): TimelineEvent[] {
  const todayISO = toISODate(new Date());
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizonISO = toISODate(horizonEnd);

  const billEvents: TimelineEvent[] = plannedBills
    .filter((bill) => bill.dueDate >= todayISO && bill.dueDate <= horizonISO)
    .map((bill) => ({
      id: `bill-${bill.id}`,
      name: bill.name,
      amount: bill.amount,
      date: bill.dueDate,
      type: "Expense" as const,
    }));

  const recurringEvents = recurringBills.flatMap((bill) =>
    getRecurringOccurrencesInRange(bill, today, horizonEnd)
      .filter((date) => date <= horizonISO)
      .map((date) => ({
        id: `recurring-${bill.id}-${date}`,
        name: bill.name,
        amount: bill.amount,
        date,
        type: "Expense" as const,
      })),
  );

  const paycheckEvents: TimelineEvent[] = plannedPaychecks
    .filter(
      (paycheck) =>
        paycheck.payDate >= todayISO && paycheck.payDate <= horizonISO,
    )
    .map((paycheck) => ({
      id: `paycheck-${paycheck.id}`,
      name: paycheck.name,
      amount: paycheck.amount,
      date: paycheck.payDate,
      type: "Income" as const,
    }));

  const manualEvents = timelineEvents.filter(
    (event) => event.date >= todayISO && event.date <= horizonISO,
  );

  return [
    ...billEvents,
    ...recurringEvents,
    ...paycheckEvents,
    ...manualEvents,
  ];
}

function runFinancialTimeline(
  checkingBalance: number,
  events: TimelineEvent[],
): FinancialTimelineResult {
  return runFinancialCalculation(checkingBalance, events);
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMonthlyBillAmount(bill: RecurringBill): number {
  if (bill.frequency === "Monthly") return bill.amount;
  if (bill.frequency === "Weekly") return (bill.amount * 52) / 12;
  return (bill.amount * 26) / 12;
}

function getTotalMonthlyRecurringBills(bills: RecurringBill[]): number {
  return bills.reduce((sum, bill) => sum + getMonthlyBillAmount(bill), 0);
}

function formatRecurringDueDay(bill: RecurringBill): string {
  if (bill.frequency === "Monthly") {
    return `Day ${bill.dueDay}`;
  }
  return WEEKDAYS[bill.dueDay] ?? `Day ${bill.dueDay}`;
}

function getRecurringOccurrencesInRange(
  bill: RecurringBill,
  start: Date,
  end: Date,
): string[] {
  const dates: string[] = [];
  const startDay = new Date(start);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(23, 59, 59, 999);

  if (bill.frequency === "Monthly") {
    let monthCursor = new Date(startDay.getFullYear(), startDay.getMonth(), 1);
    while (monthCursor <= endDay) {
      const daysInMonth = new Date(
        monthCursor.getFullYear(),
        monthCursor.getMonth() + 1,
        0,
      ).getDate();
      const day = Math.min(bill.dueDay, daysInMonth);
      const occurrence = new Date(
        monthCursor.getFullYear(),
        monthCursor.getMonth(),
        day,
      );
      if (occurrence >= startDay && occurrence <= endDay) {
        dates.push(toISODate(occurrence));
      }
      monthCursor.setMonth(monthCursor.getMonth() + 1);
    }
    return dates;
  }

  const step = bill.frequency === "Weekly" ? 7 : 14;
  const occurrence = new Date(startDay);
  occurrence.setDate(
    occurrence.getDate() + ((bill.dueDay - occurrence.getDay() + 7) % 7),
  );

  while (occurrence <= endDay) {
    if (occurrence >= startDay) {
      dates.push(toISODate(occurrence));
    }
    occurrence.setDate(occurrence.getDate() + step);
  }

  return dates;
}

function getCashFlowStatus(lowestBalance: number): CashFlowStatus {
  if (lowestBalance < 0) return "risk";
  if (lowestBalance <= 500) return "low";
  return "healthy";
}

function formatDueDate(dateString: string): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getNextIncomeDate(
  events: TimelineEvent[],
  fromDate: string,
): string | null {
  for (const event of sortTimelineEvents(events)) {
    if (event.type === "Income" && event.date >= fromDate) {
      return event.date;
    }
  }

  return null;
}

function getShortfallExpenseEvents(
  rows: FinancialTimelineResult["rows"] | undefined,
  todayISO: string,
): TimelineEvent[] {
  if (!rows?.length) return [];

  const problematic: TimelineEvent[] = [];

  for (const { event, runningBalance } of rows) {
    if (event.date < todayISO) continue;

    if (event.type === "Income") {
      break;
    }

    if (event.type === "Expense") {
      const balanceBefore = runningBalance + event.amount;
      if (balanceBefore < event.amount) {
        problematic.push(event);
      }
    }
  }

  return problematic;
}

function getDashboardCashFlowSubtitle(
  rows: FinancialTimelineResult["rows"] | undefined,
  todayISO: string,
  shortfallCause: ShortfallCause,
): string {
  const problematicEvents = getShortfallExpenseEvents(rows, todayISO);

  if (problematicEvents.length > 1) {
    return "Multiple expenses exceed cash";
  }

  if (problematicEvents.length === 1) {
    if (isPlannedPurchaseEvent(problematicEvents[0].id)) {
      return "Purchase exceeds available cash";
    }

    return "Upcoming bill creates shortage";
  }

  if (shortfallCause === "purchase") {
    return "Purchase exceeds available cash";
  }

  return "Upcoming bill creates shortage";
}

function getDashboardCashFlowMessage(
  hasShortfall: boolean,
  rows: FinancialTimelineResult["rows"] | undefined,
  todayISO: string,
  shortfallCause: ShortfallCause,
): { status: "Healthy" | "Shortfall Expected"; message: string; subtitle: string } {
  if (!hasShortfall) {
    return {
      status: "Healthy",
      message: "✅ Cash flow is healthy through upcoming bills and income.",
      subtitle: "Cash flow remains positive",
    };
  }

  return {
    status: "Shortfall Expected",
    message: "⚠️ Remove or reduce planned purchases to avoid a cash shortfall.",
    subtitle: getDashboardCashFlowSubtitle(rows, todayISO, shortfallCause),
  };
}

const cashFlowStatusStyles: Record<
  CashFlowStatus,
  { border: string; bg: string; badge: string; badgeText: string; message: string }
> = {
  risk: {
    border: "border-red-500/30",
    bg: "bg-gradient-to-br from-red-500/10 via-white/[0.02] to-red-500/5",
    badge: "bg-red-500/20",
    badgeText: "text-red-300",
    message: "Cash flow risk detected.",
  },
  low: {
    border: "border-yellow-500/30",
    bg: "bg-gradient-to-br from-yellow-500/10 via-white/[0.02] to-amber-500/5",
    badge: "bg-yellow-500/20",
    badgeText: "text-yellow-300",
    message: "Low cushion.",
  },
  healthy: {
    border: "border-emerald-500/20",
    bg: "bg-gradient-to-br from-emerald-500/10 via-white/[0.02] to-teal-500/10",
    badge: "bg-emerald-500/20",
    badgeText: "text-emerald-300",
    message: "Healthy",
  },
};

type PersistedAppData = {
  purchaseName: string;
  purchaseAmount: string;
  purchaseDate: string;
  purchaseType: PurchaseType;
  spendingDecisionResult: SpendingDecisionResult | null;
  goalName: string;
  goalAmount: string;
  currentSaved: string;
  monthlyContribution: string;
  savingsGoalCalculated: boolean;
  plannedBills: PlannedBill[];
  billName: string;
  billAmount: string;
  billDueDate: string;
  monthlyIncome: string;
  monthlyExpenses: string;
  monthlyBufferCalculated: boolean;
  emergencyMonthlyExpenses: string;
  emergencyCurrentSavings: string;
  emergencyFundCalculated: boolean;
  coachCurrentSavings: string;
  coachSavingsGoal: string;
  coachMonthlySavings: string;
  coachAdviceShown: boolean;
  timelineEvents: TimelineEvent[];
  eventName: string;
  eventAmount: string;
  eventDate: string;
  eventType: TimelineEventType;
  recurringBills: RecurringBill[];
  recurringBillName: string;
  recurringBillAmount: string;
  recurringDueDay: string;
  recurringFrequency: RecurringFrequency;
  plannedPaychecks: PlannedPaycheck[];
  paycheckName: string;
  paycheckAmount: string;
  paycheckDate: string;
  checkingBalance: string;
  profile: UserProfile;
};

const STORAGE_KEY = "financial-confidence-data";

function loadPersistedData(): PersistedAppData | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedAppData;
  } catch {
    return null;
  }
}

function savePersistedData(data: PersistedAppData): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage quota or privacy mode errors.
  }
}

type EmergencyFundStatus = "Risky" | "Okay" | "Healthy";

function getEmergencyFundStatus(monthsCovered: number): {
  status: EmergencyFundStatus;
  border: string;
  bg: string;
  badge: string;
  badgeText: string;
  value: string;
} {
  if (monthsCovered < 3) {
    return {
      status: "Risky",
      border: "border-red-500/30",
      bg: "bg-gradient-to-br from-red-500/10 via-white/[0.02] to-red-500/5",
      badge: "bg-red-500/20",
      badgeText: "text-red-300",
      value: "text-red-200",
    };
  }
  if (monthsCovered < 6) {
    return {
      status: "Okay",
      border: "border-yellow-500/30",
      bg: "bg-gradient-to-br from-yellow-500/10 via-white/[0.02] to-amber-500/5",
      badge: "bg-yellow-500/20",
      badgeText: "text-yellow-300",
      value: "text-yellow-200",
    };
  }
  return {
    status: "Healthy",
    border: "border-emerald-500/20",
    bg: "bg-gradient-to-br from-emerald-500/10 via-white/[0.02] to-teal-500/10",
    badge: "bg-emerald-500/20",
    badgeText: "text-emerald-300",
    value: "text-emerald-200",
  };
}

const spendingVerdictStyles: Record<
  SpendingVerdict,
  {
    border: string;
    bg: string;
    badge: string;
    badgeText: string;
    title: string;
  }
> = {
  "Affordable Now": {
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/10",
    badge: "bg-emerald-500/20",
    badgeText: "text-emerald-300",
    title: "text-emerald-300",
  },
  "Wait Until Payday": {
    border: "border-yellow-500/30",
    bg: "bg-yellow-500/10",
    badge: "bg-yellow-500/20",
    badgeText: "text-yellow-300",
    title: "text-yellow-300",
  },
  "Not Affordable Today": {
    border: "border-orange-500/30",
    bg: "bg-orange-500/10",
    badge: "bg-orange-500/20",
    badgeText: "text-orange-300",
    title: "text-orange-300",
  },
  "Not Affordable": {
    border: "border-red-500/30",
    bg: "bg-red-500/10",
    badge: "bg-red-500/20",
    badgeText: "text-red-300",
    title: "text-red-300",
  },
};

const dashboardStatusStyles: Record<
  "Healthy" | "Tight" | "Shortfall Expected",
  { badgeText: string }
> = {
  Healthy: { badgeText: "text-emerald-300" },
  Tight: { badgeText: "text-yellow-300" },
  "Shortfall Expected": { badgeText: "text-red-300" },
};

type SectionKey =
  | "dashboardSummary"
  | "bills"
  | "paychecks"
  | "cashFlowTimeline"
  | "goalsAndPlanning"
  | "spendingDecision";

type ProfileModal = "account" | "settings" | null;

type ProfileMenuPlacement = "bottom" | "top";

type ProfileMenuCoords = {
  top: number;
  left: number;
  placement: ProfileMenuPlacement;
};

type CollapsibleSectionProps = {
  id: string;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  iconClassName?: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
};

function CollapsibleSection({
  id,
  title,
  subtitle,
  icon,
  iconClassName = "bg-white/10 text-white",
  isOpen,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] shadow-lg shadow-black/20 backdrop-blur-xl">
      <button
        type="button"
        id={`${id}-header`}
        aria-expanded={isOpen}
        aria-controls={`${id}-panel`}
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-4 text-left sm:p-5"
      >
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconClassName}`}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          {subtitle ? (
            <p className="text-sm text-slate-500">{subtitle}</p>
          ) : null}
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {isOpen ? (
        <div
          id={`${id}-panel`}
          role="region"
          aria-labelledby={`${id}-header`}
          className="border-t border-white/10 px-4 pb-4 pt-4 sm:px-5 sm:pb-5"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export default function Home() {
  const [purchaseName, setPurchaseName] = useState("");
  const [purchaseAmount, setPurchaseAmount] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchaseType, setPurchaseType] = useState<PurchaseType>(
    "One-Time Purchase",
  );
  const [spendingDecisionResult, setSpendingDecisionResult] =
    useState<SpendingDecisionResult | null>(null);
  const [goalName, setGoalName] = useState("");
  const [goalAmount, setGoalAmount] = useState("");
  const [currentSaved, setCurrentSaved] = useState("");
  const [monthlyContribution, setMonthlyContribution] = useState("");
  const [savingsGoalCalculated, setSavingsGoalCalculated] = useState(false);
  const [plannedBills, setPlannedBills] = useState<PlannedBill[]>([]);
  const [billName, setBillName] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [billDueDate, setBillDueDate] = useState("");
  const [monthlyIncome, setMonthlyIncome] = useState("");
  const [monthlyExpenses, setMonthlyExpenses] = useState("");
  const [monthlyBufferCalculated, setMonthlyBufferCalculated] = useState(false);
  const [emergencyCurrentSavings, setEmergencyCurrentSavings] = useState("");
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [eventName, setEventName] = useState("");
  const [eventAmount, setEventAmount] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventType, setEventType] = useState<TimelineEventType>("Expense");
  const [recurringBills, setRecurringBills] = useState<RecurringBill[]>([]);
  const [recurringBillName, setRecurringBillName] = useState("");
  const [recurringBillAmount, setRecurringBillAmount] = useState("");
  const [recurringDueDay, setRecurringDueDay] = useState("1");
  const [recurringFrequency, setRecurringFrequency] =
    useState<RecurringFrequency>("Monthly");
  const [plannedPaychecks, setPlannedPaychecks] = useState<PlannedPaycheck[]>(
    [],
  );
  const [paycheckName, setPaycheckName] = useState("");
  const [paycheckAmount, setPaycheckAmount] = useState("");
  const [paycheckDate, setPaycheckDate] = useState("");
  const [checkingBalance, setCheckingBalance] = useState("");
  const [timelineFilter, setTimelineFilter] = useState<
    "all" | "income" | "expense"
  >("all");
  const [timelineSearch, setTimelineSearch] = useState("");
  const [sectionOpen, setSectionOpen] = useState<Record<SectionKey, boolean>>({
    dashboardSummary: true,
    bills: false,
    paychecks: false,
    cashFlowTimeline: false,
    goalsAndPlanning: false,
    spendingDecision: false,
  });
  const [isHydrated, setIsHydrated] = useState(false);
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileModal, setProfileModal] = useState<ProfileModal>(null);
  const [profileMessage, setProfileMessage] = useState("");
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const profileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const profileMenuPanelRef = useRef<HTMLDivElement>(null);
  const [profileMenuCoords, setProfileMenuCoords] = useState<ProfileMenuCoords>({
    top: 0,
    left: 0,
    placement: "bottom",
  });
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [editingRecurringBillId, setEditingRecurringBillId] = useState<
    string | null
  >(null);
  const [editingPaycheckId, setEditingPaycheckId] = useState<string | null>(
    null,
  );

  const toggleSection = (key: SectionKey) => {
    setSectionOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const profileDisplayName = profile.name.trim() || "Account";

  const getPersistedSnapshot = (): PersistedAppData => ({
    purchaseName,
    purchaseAmount,
    purchaseDate,
    purchaseType,
    spendingDecisionResult,
    goalName,
    goalAmount,
    currentSaved,
    monthlyContribution,
    savingsGoalCalculated,
    plannedBills,
    billName,
    billAmount,
    billDueDate,
    monthlyIncome,
    monthlyExpenses,
    monthlyBufferCalculated,
    emergencyMonthlyExpenses: monthlyExpenses,
    emergencyCurrentSavings,
    emergencyFundCalculated: monthlyBufferCalculated,
    coachCurrentSavings: currentSaved,
    coachSavingsGoal: goalAmount,
    coachMonthlySavings: monthlyContribution,
    coachAdviceShown: savingsGoalCalculated,
    timelineEvents,
    eventName,
    eventAmount,
    eventDate,
    eventType,
    recurringBills,
    recurringBillName,
    recurringBillAmount,
    recurringDueDay,
    recurringFrequency,
    plannedPaychecks,
    paycheckName,
    paycheckAmount,
    paycheckDate,
    checkingBalance,
    profile,
  });

  useEffect(() => {
    if (!profileMenuOpen) return;

    const updateMenuPosition = () => {
      const button = profileMenuButtonRef.current;
      const panel = profileMenuPanelRef.current;
      if (!button) return;

      const rect = button.getBoundingClientRect();
      const menuWidth = panel?.offsetWidth ?? 192;
      const menuHeight = panel?.offsetHeight ?? 176;
      const gap = 8;
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const spaceAbove = rect.top - gap;
      const openUpward =
        spaceBelow < menuHeight && spaceAbove >= menuHeight;

      const left = Math.min(
        Math.max(8, rect.right - menuWidth),
        window.innerWidth - menuWidth - 8,
      );
      const top = openUpward
        ? rect.top - gap - menuHeight
        : rect.bottom + gap;

      setProfileMenuCoords({
        top: Math.max(8, top),
        left,
        placement: openUpward ? "top" : "bottom",
      });
    };

    updateMenuPosition();
    const frame = requestAnimationFrame(updateMenuPosition);

    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!profileMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        profileMenuRef.current?.contains(target) ||
        profileMenuPanelRef.current?.contains(target)
      ) {
        return;
      }
      setProfileMenuOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [profileMenuOpen]);

  const totalUpcomingBills = plannedBills.reduce(
    (sum, bill) => sum + bill.amount,
    0,
  );

  const totalMonthlyRecurringBills = getTotalMonthlyRecurringBills(recurringBills);
  const checkingBalanceAmount = Number(checkingBalance) || 0;
  const hasDashboardData =
    checkingBalance !== "" ||
    plannedBills.length > 0 ||
    recurringBills.length > 0 ||
    plannedPaychecks.length > 0 ||
    purchaseAmount !== "" ||
    spendingDecisionResult !== null;

  const timelineHorizonEnd = getSafeToSpendHorizonEnd(plannedPaychecks);
  const unifiedTimelineEvents = buildFinancialTimelineEvents(
    plannedBills,
    recurringBills,
    plannedPaychecks,
    timelineEvents,
    timelineHorizonEnd,
  );

  const financialCalculation =
    checkingBalance !== "" || unifiedTimelineEvents.length > 0
      ? runFinancialCalculation(checkingBalanceAmount, unifiedTimelineEvents)
      : null;

  const effectiveSafeToSpend = financialCalculation?.safeToSpend ?? 0;
  const cashShortfallDetected = financialCalculation?.hasShortfall ?? false;
  const cashFlowProjection = financialCalculation;

  useEffect(() => {
    const saved = loadPersistedData();
    if (saved) {
      const legacySaved = saved as PersistedAppData & {
        balance?: string;
        purchaseQuestion?: string;
        purchaseFrequency?: string;
        affordabilityResult?: SpendingDecisionResult | null;
        profile?: UserProfile & {
          defaultCheckingBalance?: string;
          typicalNetPaycheck?: string;
          payFrequency?: string;
          mainSavingsGoalAmount?: string;
          email?: string;
        };
      };

      setPurchaseName(
        legacySaved.purchaseName ?? legacySaved.purchaseQuestion ?? "",
      );
      setPurchaseAmount(legacySaved.purchaseAmount ?? "");
      setPurchaseDate(legacySaved.purchaseDate ?? "");
      setPurchaseType(
        normalizePurchaseType(
          legacySaved.purchaseType ?? legacySaved.purchaseFrequency,
        ),
      );
      setSpendingDecisionResult(
        normalizeSpendingDecisionResult(
          legacySaved.spendingDecisionResult ??
            legacySaved.affordabilityResult ??
            null,
        ),
      );
      setPlannedBills(legacySaved.plannedBills);
      setBillName(legacySaved.billName);
      setBillAmount(legacySaved.billAmount);
      setBillDueDate(legacySaved.billDueDate);
      setMonthlyIncome(legacySaved.monthlyIncome);
      setMonthlyExpenses(
        legacySaved.monthlyExpenses || legacySaved.emergencyMonthlyExpenses || "",
      );
      setMonthlyBufferCalculated(
        legacySaved.monthlyBufferCalculated ||
          legacySaved.emergencyFundCalculated ||
          false,
      );
      setEmergencyCurrentSavings(legacySaved.emergencyCurrentSavings ?? "");
      setCheckingBalance(
        legacySaved.checkingBalance ?? legacySaved.balance ?? "",
      );
      setGoalName(legacySaved.goalName);
      setGoalAmount(legacySaved.goalAmount || legacySaved.coachSavingsGoal || "");
      setCurrentSaved(
        legacySaved.currentSaved || legacySaved.coachCurrentSavings || "",
      );
      setMonthlyContribution(
        legacySaved.monthlyContribution || legacySaved.coachMonthlySavings || "",
      );
      setSavingsGoalCalculated(
        legacySaved.savingsGoalCalculated || legacySaved.coachAdviceShown || false,
      );
      setTimelineEvents(legacySaved.timelineEvents ?? []);
      setEventName(legacySaved.eventName ?? "");
      setEventAmount(legacySaved.eventAmount ?? "");
      setEventDate(legacySaved.eventDate ?? "");
      setEventType(legacySaved.eventType ?? "Expense");
      setRecurringBills(legacySaved.recurringBills ?? []);
      setRecurringBillName(legacySaved.recurringBillName ?? "");
      setRecurringBillAmount(legacySaved.recurringBillAmount ?? "");
      setRecurringDueDay(legacySaved.recurringDueDay ?? "1");
      setRecurringFrequency(legacySaved.recurringFrequency ?? "Monthly");
      setPlannedPaychecks(legacySaved.plannedPaychecks ?? []);
      setPaycheckName(legacySaved.paycheckName ?? "");
      setPaycheckAmount(legacySaved.paycheckAmount ?? "");
      setPaycheckDate(legacySaved.paycheckDate ?? "");

      const loadedProfile = legacySaved.profile;
      setProfile({
        name: loadedProfile?.name ?? "",
        email: loadedProfile?.email ?? "",
      });
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;

    savePersistedData(getPersistedSnapshot());
  }, [
    isHydrated,
    recurringBills,
    purchaseName,
    purchaseAmount,
    purchaseDate,
    purchaseType,
    spendingDecisionResult,
    goalName,
    goalAmount,
    currentSaved,
    monthlyContribution,
    savingsGoalCalculated,
    plannedBills,
    billName,
    billAmount,
    billDueDate,
    monthlyIncome,
    monthlyExpenses,
    monthlyBufferCalculated,
    emergencyCurrentSavings,
    timelineEvents,
    eventName,
    eventAmount,
    eventDate,
    eventType,
    recurringBillName,
    recurringBillAmount,
    recurringDueDay,
    recurringFrequency,
    plannedPaychecks,
    paycheckName,
    paycheckAmount,
    paycheckDate,
    checkingBalance,
    profile,
  ]);

  const monthlySurplusSummary =
    monthlyIncome !== "" || monthlyExpenses !== ""
      ? (Number(monthlyIncome) || 0) - (Number(monthlyExpenses) || 0)
      : null;

  const emergencyMonthsCovered =
    Number(monthlyExpenses) > 0
      ? (Number(emergencyCurrentSavings) || 0) / Number(monthlyExpenses)
      : null;

  const emergencyFundStatus =
    emergencyMonthsCovered !== null
      ? getEmergencyFundStatus(emergencyMonthsCovered)
      : null;

  const emergencyMonthsCoveredLabel =
    emergencyMonthsCovered === null
      ? null
      : (() => {
          const displayMonths =
            emergencyMonthsCovered % 1 === 0
              ? emergencyMonthsCovered
              : emergencyMonthsCovered.toFixed(1);
          return `${displayMonths} ${
            emergencyMonthsCovered === 1 ? "Month" : "Months"
          } Covered`;
        })();

  const calculateSavingsGoal = () => {
    setSavingsGoalCalculated(true);
  };

  const saveProfile = () => {
    savePersistedData(getPersistedSnapshot());
    setProfileMessage("Account saved.");
    setProfileModal(null);
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(getPersistedSnapshot(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `financial-confidence-${toISODate(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setProfileMenuOpen(false);
  };

  const resetAllData = () => {
    if (
      !window.confirm(
        "Reset all data? This clears your bills, paychecks, goals, and profile.",
      )
    ) {
      return;
    }

    localStorage.removeItem(STORAGE_KEY);
    setPurchaseName("");
    setPurchaseAmount("");
    setPurchaseDate("");
    setPurchaseType("One-Time Purchase");
    setSpendingDecisionResult(null);
    setGoalName("");
    setGoalAmount("");
    setCurrentSaved("");
    setMonthlyContribution("");
    setSavingsGoalCalculated(false);
    setPlannedBills([]);
    setBillName("");
    setBillAmount("");
    setBillDueDate("");
    setMonthlyIncome("");
    setMonthlyExpenses("");
    setMonthlyBufferCalculated(false);
    setEmergencyCurrentSavings("");
    setTimelineEvents([]);
    setEventName("");
    setEventAmount("");
    setEventDate("");
    setEventType("Expense");
    setRecurringBills([]);
    setRecurringBillName("");
    setRecurringBillAmount("");
    setRecurringDueDay("1");
    setRecurringFrequency("Monthly");
    setPlannedPaychecks([]);
    setPaycheckName("");
    setPaycheckAmount("");
    setPaycheckDate("");
    setCheckingBalance("");
    setProfile(DEFAULT_PROFILE);
    setProfileMessage("");
    setProfileMenuOpen(false);
    setProfileModal(null);
  };

  const calculateMonthlyBuffer = () => {
    setMonthlyBufferCalculated(true);
  };

  const saveOneTimeBill = () => {
    const name = billName.trim();
    const amount = Number(billAmount);
    const dueDate = billDueDate.trim();

    if (!name || !dueDate || Number.isNaN(amount) || amount <= 0) return;

    if (editingBillId) {
      setPlannedBills((prev) =>
        prev.map((bill) =>
          bill.id === editingBillId ? { ...bill, name, amount, dueDate } : bill,
        ),
      );
      setEditingBillId(null);
    } else {
      setPlannedBills((prev) => [
        ...prev,
        { id: crypto.randomUUID(), name, amount, dueDate },
      ]);
    }

    setBillName("");
    setBillAmount("");
    setBillDueDate("");
  };

  const startEditBill = (bill: PlannedBill) => {
    setEditingBillId(bill.id);
    setBillName(bill.name);
    setBillAmount(String(bill.amount));
    setBillDueDate(bill.dueDate);
  };

  const removeBill = (id: string) => {
    setPlannedBills((prev) => prev.filter((bill) => bill.id !== id));
    if (editingBillId === id) {
      setEditingBillId(null);
      setBillName("");
      setBillAmount("");
      setBillDueDate("");
    }
  };

  const saveRecurringBill = () => {
    const name = recurringBillName.trim();
    const amount = Number(recurringBillAmount);
    const dueDay = Number(recurringDueDay);

    if (!name || Number.isNaN(amount) || amount <= 0 || Number.isNaN(dueDay)) {
      return;
    }

    if (recurringFrequency === "Monthly") {
      if (dueDay < 1 || dueDay > 31) return;
    } else if (dueDay < 0 || dueDay > 6) {
      return;
    }

    if (editingRecurringBillId) {
      setRecurringBills((prev) =>
        prev.map((bill) =>
          bill.id === editingRecurringBillId
            ? {
                ...bill,
                name,
                amount,
                dueDay,
                frequency: recurringFrequency,
              }
            : bill,
        ),
      );
      setEditingRecurringBillId(null);
    } else {
      setRecurringBills((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          name,
          amount,
          dueDay,
          frequency: recurringFrequency,
        },
      ]);
    }

    setRecurringBillName("");
    setRecurringBillAmount("");
    setRecurringDueDay(recurringFrequency === "Monthly" ? "1" : "1");
    setRecurringFrequency("Monthly");
  };

  const startEditRecurringBill = (bill: RecurringBill) => {
    setEditingRecurringBillId(bill.id);
    setRecurringBillName(bill.name);
    setRecurringBillAmount(String(bill.amount));
    setRecurringDueDay(String(bill.dueDay));
    setRecurringFrequency(bill.frequency);
  };

  const removeRecurringBill = (id: string) => {
    setRecurringBills((prev) => prev.filter((bill) => bill.id !== id));
    if (editingRecurringBillId === id) {
      setEditingRecurringBillId(null);
      setRecurringBillName("");
      setRecurringBillAmount("");
      setRecurringDueDay("1");
      setRecurringFrequency("Monthly");
    }
  };

  const savePaycheck = () => {
    const name = paycheckName.trim();
    const amount = Number(paycheckAmount);
    const payDate = paycheckDate.trim();

    if (!name || !payDate || Number.isNaN(amount) || amount <= 0) return;

    if (editingPaycheckId) {
      setPlannedPaychecks((prev) =>
        prev.map((paycheck) =>
          paycheck.id === editingPaycheckId
            ? { ...paycheck, name, amount, payDate }
            : paycheck,
        ),
      );
      setEditingPaycheckId(null);
    } else {
      setPlannedPaychecks((prev) => [
        ...prev,
        { id: crypto.randomUUID(), name, amount, payDate },
      ]);
    }

    setPaycheckName("");
    setPaycheckAmount("");
    setPaycheckDate("");
  };

  const startEditPaycheck = (paycheck: PlannedPaycheck) => {
    setEditingPaycheckId(paycheck.id);
    setPaycheckName(paycheck.name);
    setPaycheckAmount(String(paycheck.amount));
    setPaycheckDate(paycheck.payDate);
  };

  const removePaycheck = (id: string) => {
    setPlannedPaychecks((prev) => prev.filter((paycheck) => paycheck.id !== id));
    if (editingPaycheckId === id) {
      setEditingPaycheckId(null);
      setPaycheckName("");
      setPaycheckAmount("");
      setPaycheckDate("");
    }
  };

  const submitSpendingDecision = () => {
    const name = purchaseName.trim();
    const cost = Number(purchaseAmount);

    if (!name || Number.isNaN(cost) || cost <= 0) return;

    setSpendingDecisionResult(
      evaluateSpendingDecision(
        name,
        cost,
        purchaseType,
        effectiveSafeToSpend,
        checkingBalanceAmount,
        unifiedTimelineEvents,
        purchaseDate,
      ),
    );
  };

  const getDecisionTimelineAmount = (result: SpendingDecisionResult) =>
    result.purchaseCost;

  const isCurrentDecisionOnTimeline =
    spendingDecisionResult !== null &&
    purchaseDate.trim() !== "" &&
    timelineEvents.some(
      (event) =>
        isPlannedPurchaseEvent(event.id) &&
        event.name === spendingDecisionResult.purchaseName &&
        event.amount === getDecisionTimelineAmount(spendingDecisionResult) &&
        event.date === purchaseDate.trim(),
    );

  const planThisPurchase = () => {
    if (!spendingDecisionResult || purchaseDate.trim() === "") return;
    if (isCurrentDecisionOnTimeline) return;

    setTimelineEvents((prev) => [
      ...prev,
      {
        id: `planned-purchase-${crypto.randomUUID()}`,
        name: spendingDecisionResult.purchaseName,
        amount: getDecisionTimelineAmount(spendingDecisionResult),
        date: purchaseDate.trim(),
        type: "Expense",
      },
    ]);
    setSpendingDecisionResult(null);
  };

  const cancelSpendingDecision = () => {
    setSpendingDecisionResult(null);
  };

  const removePlannedPurchase = (eventId: string) => {
    setTimelineEvents((prev) => prev.filter((event) => event.id !== eventId));
  };

  const addTimelineEvent = () => {
    const name = eventName.trim();
    const amount = Number(eventAmount);
    const date = eventDate.trim();

    if (!name || !date || Number.isNaN(amount) || amount <= 0) return;

    setTimelineEvents((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name, amount, date, type: eventType },
    ]);
    setEventName("");
    setEventAmount("");
    setEventDate("");
    setEventType("Expense");
  };

  const clearTimeline = () => {
    setTimelineEvents([]);
  };

  const profileName = profile.name.trim();
  const todayISO = toISODate(new Date());
  const nextUpcomingPaycheck = getNextUpcomingPaycheck(plannedPaychecks);
  const nextPaycheckLabel = nextUpcomingPaycheck
    ? formatDueDate(nextUpcomingPaycheck.payDate)
    : "Not scheduled yet";
  const dashboardCashFlow = getDashboardCashFlowMessage(
    cashShortfallDetected,
    financialCalculation?.rows,
    todayISO,
    financialCalculation?.shortfallCause ?? null,
  );
  const dashboardCashFlowLabel = dashboardCashFlow.status;
  const dashboardCashFlowSubtitle = dashboardCashFlow.subtitle;
  const dashboardHealthMessage = dashboardCashFlow.message;

  const timelineTotals = unifiedTimelineEvents.reduce(
    (acc, event) => {
      if (event.type === "Income") {
        acc.income += event.amount;
      } else {
        acc.expenses += event.amount;
      }
      return acc;
    },
    { income: 0, expenses: 0 },
  );
  const timelineNetCashFlow = timelineTotals.income - timelineTotals.expenses;

  const visibleTimelineRows =
    cashFlowProjection?.rows.filter(({ event }) => {
      const matchesType =
        timelineFilter === "all" ||
        (timelineFilter === "income" && event.type === "Income") ||
        (timelineFilter === "expense" && event.type === "Expense");
      const searchTerm = timelineSearch.trim().toLowerCase();
      const matchesSearch =
        searchTerm === "" || event.name.toLowerCase().includes(searchTerm);
      return matchesType && matchesSearch;
    }) ?? [];

  return (
    <div className="relative min-h-screen bg-slate-950 font-sans text-white">
      {/* Background */}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(59,130,246,0.35),transparent)]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_110%)]"
        aria-hidden="true"
      />

      {/* Nav */}
      <header
        className={`relative border-b border-white/10 ${profileMenuOpen ? "z-[200]" : "z-20"}`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold shadow-lg shadow-blue-600/30">
              FC
            </div>
            <span className="text-sm font-semibold tracking-tight sm:text-base">
              Financial Confidence
            </span>
          </div>
          <div className="relative" ref={profileMenuRef}>
            <button
              ref={profileMenuButtonRef}
              type="button"
              onClick={() => setProfileMenuOpen((open) => !open)}
              aria-expanded={profileMenuOpen}
              aria-haspopup="menu"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300 backdrop-blur-sm transition hover:border-white/20 hover:bg-white/[0.08]"
            >
              <span>{profileDisplayName}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`h-3.5 w-3.5 text-slate-400 transition-transform ${profileMenuOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {profileMenuOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={profileMenuPanelRef}
              role="menu"
              style={{
                top: profileMenuCoords.top,
                left: profileMenuCoords.left,
              }}
              className="fixed z-[200] w-48 rounded-xl border border-white/10 bg-slate-900 py-1 shadow-2xl shadow-black/40 backdrop-blur-xl"
            >
              {[
                {
                  label: "My Account",
                  action: () => {
                    setProfileModal("account");
                    setProfileMenuOpen(false);
                  },
                },
                {
                  label: "Export Data",
                  action: exportData,
                },
                {
                  label: "Reset Data",
                  action: resetAllData,
                  danger: true,
                },
                {
                  label: "Settings",
                  action: () => {
                    setProfileModal("settings");
                    setProfileMenuOpen(false);
                  },
                },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={item.action}
                  className={`block w-full px-4 py-2.5 text-left text-sm transition hover:bg-white/[0.06] ${
                    item.danger
                      ? "text-red-300 hover:text-red-200"
                      : "text-slate-200"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}

      <main className="relative z-10 mx-auto max-w-6xl overflow-x-hidden px-4 py-8 sm:px-6 sm:py-12 lg:px-8 lg:py-16">
        <div className="grid items-start gap-8 lg:grid-cols-2 lg:gap-12 xl:gap-16">
          {/* Hero */}
          <section className="min-w-0 text-center lg:text-left">
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-1.5 text-xs font-medium text-blue-300 sm:text-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
              Smart spending, simplified
            </p>

            <h1 className="text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
              Financial
              <span className="block bg-gradient-to-r from-blue-400 via-blue-300 to-cyan-300 bg-clip-text text-transparent">
                Confidence
              </span>
            </h1>

            <p className="mt-6 max-w-lg text-lg leading-relaxed text-slate-400 sm:text-xl lg:mx-0 lg:max-w-md">
              Know what you can safely spend before you buy.
            </p>

            <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-500 lg:mx-0">
              Set up your bills, paychecks, and goals once — then make every
              spending decision with confidence, not guesswork.
            </p>

            {/* Stats */}
            <dl className="mt-10 grid grid-cols-3 gap-4 border-t border-white/10 pt-8 sm:gap-6">
              {[
                { value: "1 Minute", label: "Setup" },
                { value: "100%", label: "Private" },
                { value: "Real-Time", label: "Decisions" },
              ].map((stat) => (
                <div key={stat.label}>
                  <dt className="text-lg font-bold text-white sm:text-xl">
                    {stat.value}
                  </dt>
                  <dd className="mt-0.5 text-xs text-slate-500 sm:text-sm">
                    {stat.label}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Calculator */}
          <section className="min-w-0">
            <div className="space-y-4 overflow-x-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-6 lg:p-8">
              <CollapsibleSection
                id="dashboard-summary"
                title="Dashboard"
                subtitle="Your financial snapshot"
                iconClassName="bg-blue-600/20 text-blue-400"
                isOpen={sectionOpen.dashboardSummary}
                onToggle={() => toggleSection("dashboardSummary")}
                icon={
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <path d="M3 13h18M3 6h18M3 20h18" />
                  </svg>
                }
              >
                <div className="space-y-1">
                  <p className="text-xl font-semibold text-white sm:text-2xl">
                    {profileName
                      ? `Welcome back, ${profileName} 👋`
                      : "Welcome back 👋"}
                  </p>
                  <p className="text-sm text-slate-400 sm:text-base">
                    Here&apos;s your cash flow outlook.
                  </p>
                </div>
                <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-400 sm:text-sm">
                      Current Balance
                    </dt>
                    <dd className="mt-2 text-xl font-bold tabular-nums text-white sm:text-2xl">
                      ${checkingBalanceAmount}
                    </dd>
                    <dd className="mt-1 text-xs text-slate-500 sm:text-sm">
                      In your checking account today
                    </dd>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-400 sm:text-sm">
                      Next Paycheck
                    </dt>
                    <dd className="mt-2 break-words text-lg font-bold leading-snug text-white sm:text-2xl">
                      {nextPaycheckLabel}
                    </dd>
                    <dd className="mt-1 text-xs text-slate-500 sm:text-sm">
                      Your next payday
                    </dd>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-400 sm:text-sm">
                      Safe To Spend
                    </dt>
                    <dd className="mt-2 text-xl font-bold tabular-nums text-white sm:text-2xl">
                      ${effectiveSafeToSpend}
                    </dd>
                    <dd className="mt-1 text-xs text-slate-500 sm:text-sm">
                      Without creating a shortfall
                    </dd>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-400 sm:text-sm">
                      Cash Flow Status
                    </dt>
                    <dd
                      className={`mt-2 text-xl font-bold sm:text-2xl ${
                        dashboardStatusStyles[dashboardCashFlowLabel].badgeText
                      }`}
                    >
                      {dashboardCashFlowLabel}
                    </dd>
                    <dd className="mt-1 text-xs text-slate-500 sm:text-sm">
                      {dashboardCashFlowSubtitle}
                    </dd>
                  </div>
                </dl>
                <p
                  role="status"
                  className={`mt-5 rounded-xl border px-4 py-3 text-sm sm:text-base ${
                    cashShortfallDetected
                      ? "border-red-500/30 bg-red-500/10 text-red-200"
                      : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                  }`}
                >
                  {dashboardHealthMessage}
                </p>
              </CollapsibleSection>

              <CollapsibleSection
                id="bills"
                title="Bills"
                subtitle="Manage one-time and recurring bills"
                iconClassName="bg-amber-600/20 text-amber-400"
                isOpen={sectionOpen.bills}
                onToggle={() => toggleSection("bills")}
                icon={
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
                  </svg>
                }
              >
                <div className="space-y-6">
                  <div>
                    <h4 className="mb-3 text-sm font-semibold text-amber-300">
                      One-Time Bill
                    </h4>
                    <form
                      className="space-y-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveOneTimeBill();
                      }}
                    >
                  <div>
                    <label
                      htmlFor="bill-name"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Bill Name
                    </label>
                    <input
                      id="bill-name"
                      type="text"
                      placeholder="Example: Rent"
                      value={billName}
                      onChange={(e) => setBillName(e.target.value)}
                      className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder:text-slate-600 transition focus:border-amber-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="bill-amount"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Bill Amount
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-500">
                        $
                      </span>
                      <input
                        id="bill-amount"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={billAmount}
                        onChange={(e) => setBillAmount(e.target.value)}
                        className="block w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-9 pr-4 text-white placeholder:text-slate-600 transition focus:border-amber-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="bill-due-date"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Due Date
                    </label>
                    <input
                      id="bill-due-date"
                      type="date"
                      value={billDueDate}
                      onChange={(e) => setBillDueDate(e.target.value)}
                      className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder:text-slate-600 transition focus:border-amber-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-amber-500/20 [color-scheme:dark]"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full rounded-xl border border-amber-500/40 bg-amber-600/20 py-3.5 text-sm font-semibold text-amber-300 transition hover:border-amber-500/60 hover:bg-amber-600/30 focus:outline-none focus:ring-2 focus:ring-amber-500/20 active:bg-amber-600/40"
                  >
                    {editingBillId ? "Save Bill" : "Add Bill"}
                  </button>
                    </form>

                    {plannedBills.length > 0 && (
                      <div className="mt-5 space-y-4">
                        <ul className="space-y-2">
                          {plannedBills.map((bill) => (
                            <li
                              key={bill.id}
                              className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-white">{bill.name}</p>
                                <p className="text-xs text-slate-500">
                                  One-time · {formatDueDate(bill.dueDate)}
                                </p>
                              </div>
                              <span className="font-semibold tabular-nums text-amber-200">
                                ${bill.amount}
                              </span>
                              <div className="flex shrink-0 gap-2">
                                <button
                                  type="button"
                                  onClick={() => startEditBill(bill)}
                                  className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400 transition hover:border-amber-500/40 hover:text-amber-300"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeBill(bill.id)}
                                  className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400 transition hover:border-red-500/40 hover:text-red-300"
                                  aria-label={`Remove ${bill.name}`}
                                >
                                  Delete
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>

                        <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm">
                          <span className="font-medium text-amber-300">
                            Total Upcoming Bills
                          </span>
                          <span className="text-lg font-bold tabular-nums text-white">
                            ${totalUpcomingBills}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-white/10 pt-6">
                    <h4 className="mb-3 text-sm font-semibold text-rose-300">
                      Recurring Bill
                    </h4>
                    <form
                      className="space-y-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveRecurringBill();
                      }}
                    >
                  <div>
                    <label
                      htmlFor="recurring-bill-name"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Bill Name
                    </label>
                    <input
                      id="recurring-bill-name"
                      type="text"
                      placeholder="Example: Rent"
                      value={recurringBillName}
                      onChange={(e) => setRecurringBillName(e.target.value)}
                      className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder:text-slate-600 transition focus:border-rose-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="recurring-bill-amount"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Amount
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-500">
                        $
                      </span>
                      <input
                        id="recurring-bill-amount"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={recurringBillAmount}
                        onChange={(e) => setRecurringBillAmount(e.target.value)}
                        className="block w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-9 pr-4 text-white placeholder:text-slate-600 transition focus:border-rose-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="recurring-frequency"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Frequency
                    </label>
                    <select
                      id="recurring-frequency"
                      value={recurringFrequency}
                      onChange={(e) => {
                        const frequency = e.target.value as RecurringFrequency;
                        setRecurringFrequency(frequency);
                        setRecurringDueDay(frequency === "Monthly" ? "1" : "1");
                      }}
                      className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white transition focus:border-rose-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                    >
                      <option value="Monthly">Monthly</option>
                      <option value="Weekly">Weekly</option>
                      <option value="Biweekly">Biweekly</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="recurring-due-day"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Due Day
                    </label>
                    {recurringFrequency === "Monthly" ? (
                      <input
                        id="recurring-due-day"
                        type="number"
                        min="1"
                        max="31"
                        step="1"
                        placeholder="1"
                        value={recurringDueDay}
                        onChange={(e) => setRecurringDueDay(e.target.value)}
                        className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder:text-slate-600 transition focus:border-rose-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                      />
                    ) : (
                      <select
                        id="recurring-due-day"
                        value={recurringDueDay}
                        onChange={(e) => setRecurringDueDay(e.target.value)}
                        className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white transition focus:border-rose-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                      >
                        {WEEKDAYS.map((day, index) => (
                          <option key={day} value={index}>
                            {day}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <button
                    type="submit"
                    className="w-full rounded-xl border border-rose-500/40 bg-rose-600/20 py-3.5 text-sm font-semibold text-rose-300 transition hover:border-rose-500/60 hover:bg-rose-600/30 focus:outline-none focus:ring-2 focus:ring-rose-500/20 active:bg-rose-600/40"
                  >
                    {editingRecurringBillId
                      ? "Save Recurring Bill"
                      : "Add Recurring Bill"}
                  </button>
                    </form>

                    {recurringBills.length > 0 && (
                      <div className="mt-5 space-y-4">
                        <ul className="space-y-2">
                          {recurringBills.map((bill) => (
                            <li
                              key={bill.id}
                              className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-white">{bill.name}</p>
                                <p className="text-xs text-slate-500">
                                  {bill.frequency} · {formatRecurringDueDay(bill)}
                                </p>
                              </div>
                              <span className="font-semibold tabular-nums text-rose-200">
                                ${bill.amount}
                              </span>
                              <div className="flex shrink-0 gap-2">
                                <button
                                  type="button"
                                  onClick={() => startEditRecurringBill(bill)}
                                  className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400 transition hover:border-rose-500/40 hover:text-rose-300"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeRecurringBill(bill.id)}
                                  className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400 transition hover:border-red-500/40 hover:text-red-300"
                                  aria-label={`Remove ${bill.name}`}
                                >
                                  Delete
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>

                        <div className="flex items-center justify-between gap-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm">
                          <span className="font-medium text-rose-300">
                            Total Monthly Bills
                          </span>
                          <span className="text-lg font-bold tabular-nums text-white">
                            ${Math.round(totalMonthlyRecurringBills * 100) / 100}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </CollapsibleSection>

              <CollapsibleSection
                id="paychecks"
                title="Paychecks"
                subtitle="Add upcoming paychecks manually — amounts can vary"
                iconClassName="bg-emerald-600/20 text-emerald-400"
                isOpen={sectionOpen.paychecks}
                onToggle={() => toggleSection("paychecks")}
                icon={
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <rect x="2" y="6" width="20" height="12" rx="2" />
                    <circle cx="12" cy="12" r="2" />
                    <path d="M6 12h.01M18 12h.01" />
                  </svg>
                }
              >
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    savePaycheck();
                  }}
                >
                  <div>
                    <label
                      htmlFor="paycheck-name"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Paycheck Name
                    </label>
                    <input
                      id="paycheck-name"
                      type="text"
                      placeholder="Example: Week 1 Pay"
                      value={paycheckName}
                      onChange={(e) => setPaycheckName(e.target.value)}
                      className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder:text-slate-600 transition focus:border-emerald-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="paycheck-amount"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Net Paycheck Amount
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-500">
                        $
                      </span>
                      <input
                        id="paycheck-amount"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={paycheckAmount}
                        onChange={(e) => setPaycheckAmount(e.target.value)}
                        className="block w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-9 pr-4 text-white placeholder:text-slate-600 transition focus:border-emerald-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="paycheck-date"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Pay Date
                    </label>
                    <input
                      id="paycheck-date"
                      type="date"
                      value={paycheckDate}
                      onChange={(e) => setPaycheckDate(e.target.value)}
                      className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder:text-slate-600 transition focus:border-emerald-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 [color-scheme:dark]"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full rounded-xl border border-emerald-500/40 bg-emerald-600/20 py-3.5 text-sm font-semibold text-emerald-300 transition hover:border-emerald-500/60 hover:bg-emerald-600/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 active:bg-emerald-600/40"
                  >
                    {editingPaycheckId ? "Save Paycheck" : "Add Paycheck"}
                  </button>
                </form>

                {plannedPaychecks.length > 0 && (
                  <div className="mt-5">
                    <ul className="space-y-2">
                      {[...plannedPaychecks]
                        .sort((a, b) => a.payDate.localeCompare(b.payDate))
                        .map((paycheck) => (
                          <li
                            key={paycheck.id}
                            className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-white">
                                {paycheck.name}
                              </p>
                              <p className="text-xs text-slate-500">
                                {formatDueDate(paycheck.payDate)}
                              </p>
                            </div>
                            <span className="font-semibold tabular-nums text-emerald-200">
                              ${paycheck.amount}
                            </span>
                            <div className="flex shrink-0 gap-2">
                              <button
                                type="button"
                                onClick={() => startEditPaycheck(paycheck)}
                                className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400 transition hover:border-emerald-500/40 hover:text-emerald-300"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => removePaycheck(paycheck.id)}
                                className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400 transition hover:border-red-500/40 hover:text-red-300"
                                aria-label={`Remove ${paycheck.name}`}
                              >
                                Delete
                              </button>
                            </div>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </CollapsibleSection>

              <CollapsibleSection
                id="cash-flow-timeline"
                title="Cash Flow Timeline"
                subtitle="Includes paychecks, recurring bills, and manual timeline events"
                iconClassName="bg-teal-600/20 text-teal-400"
                isOpen={sectionOpen.cashFlowTimeline}
                onToggle={() => toggleSection("cashFlowTimeline")}
                icon={
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <path d="M12 8v4l3 3M3 12a9 9 0 1018 0 9 9 0 00-18 0z" />
                  </svg>
                }
              >
                <div>
                  <label
                    htmlFor="checking-balance"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Checking Balance
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-500">
                      $
                    </span>
                    <input
                      id="checking-balance"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={checkingBalance}
                      onChange={(e) => setCheckingBalance(e.target.value)}
                      className="block w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-9 pr-4 text-white placeholder:text-slate-600 transition focus:border-teal-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    />
                  </div>
                </div>

                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addTimelineEvent();
                  }}
                >
                  <div>
                    <label
                      htmlFor="event-name"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Event Name
                    </label>
                    <input
                      id="event-name"
                      type="text"
                      placeholder="Example: Paycheck"
                      value={eventName}
                      onChange={(e) => setEventName(e.target.value)}
                      className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder:text-slate-600 transition focus:border-teal-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="event-amount"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Event Amount
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-500">
                        $
                      </span>
                      <input
                        id="event-amount"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={eventAmount}
                        onChange={(e) => setEventAmount(e.target.value)}
                        className="block w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-9 pr-4 text-white placeholder:text-slate-600 transition focus:border-teal-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="event-date"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Event Date
                    </label>
                    <input
                      id="event-date"
                      type="date"
                      value={eventDate}
                      onChange={(e) => setEventDate(e.target.value)}
                      className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder:text-slate-600 transition focus:border-teal-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-teal-500/20 [color-scheme:dark]"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="event-type"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Event Type
                    </label>
                    <select
                      id="event-type"
                      value={eventType}
                      onChange={(e) =>
                        setEventType(e.target.value as TimelineEventType)
                      }
                      className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white transition focus:border-teal-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    >
                      <option value="Income">Income</option>
                      <option value="Expense">Expense</option>
                    </select>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="submit"
                      className="w-full min-w-0 rounded-xl border border-teal-500/40 bg-teal-600/20 py-3.5 text-sm font-semibold text-teal-300 transition hover:border-teal-500/60 hover:bg-teal-600/30 focus:outline-none focus:ring-2 focus:ring-teal-500/20 active:bg-teal-600/40"
                    >
                      Add Timeline Event
                    </button>
                    <button
                      type="button"
                      onClick={clearTimeline}
                      disabled={timelineEvents.length === 0}
                      className="w-full min-w-0 rounded-xl border border-white/10 bg-white/5 py-3.5 text-sm font-semibold text-slate-200 transition hover:border-teal-500/40 hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-teal-500/20 active:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Clear Timeline
                    </button>
                  </div>
                </form>

                {cashFlowProjection && (
                  <div className="mt-5 space-y-4">
                    <dl className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
                        <dt className="text-slate-400">Starting Balance</dt>
                        <dd className="mt-1 font-bold tabular-nums text-white">
                          ${cashFlowProjection.startingBalance}
                        </dd>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
                        <dt className="text-slate-400">Lowest Projected Balance</dt>
                        <dd
                          className={`mt-1 font-bold tabular-nums ${
                            cashFlowProjection.lowestBalanceBeforeNextPaycheck < 0
                              ? "text-red-300"
                              : cashFlowProjection.lowestBalanceBeforeNextPaycheck <= 500
                                ? "text-yellow-200"
                                : "text-emerald-200"
                          }`}
                        >
                          ${cashFlowProjection.lowestBalanceBeforeNextPaycheck}
                        </dd>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
                        <dt className="text-slate-400">Ending Projected Balance</dt>
                        <dd className="mt-1 font-bold tabular-nums text-white">
                          ${cashFlowProjection.endingBalance}
                        </dd>
                      </div>
                    </dl>

                    {unifiedTimelineEvents.length > 0 && (
                      <dl className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm">
                          <dt className="text-emerald-400">Total Income</dt>
                          <dd className="mt-1 font-bold tabular-nums text-emerald-300">
                            ${timelineTotals.income}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm">
                          <dt className="text-red-400">Total Expenses</dt>
                          <dd className="mt-1 font-bold tabular-nums text-red-300">
                            ${timelineTotals.expenses}
                          </dd>
                        </div>
                        <div
                          className={`rounded-lg border px-4 py-3 text-sm ${
                            timelineNetCashFlow >= 0
                              ? "border-emerald-500/20 bg-emerald-500/5"
                              : "border-red-500/20 bg-red-500/5"
                          }`}
                        >
                          <dt
                            className={
                              timelineNetCashFlow >= 0
                                ? "text-emerald-400"
                                : "text-red-400"
                            }
                          >
                            Net Cash Flow
                          </dt>
                          <dd
                            className={`mt-1 font-bold tabular-nums ${
                              timelineNetCashFlow >= 0
                                ? "text-emerald-300"
                                : "text-red-300"
                            }`}
                          >
                            {timelineNetCashFlow >= 0 ? "+" : "-"}$
                            {Math.abs(timelineNetCashFlow)}
                          </dd>
                        </div>
                      </dl>
                    )}

                    {cashFlowProjection.rows.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setTimelineFilter("all")}
                            className={`rounded-lg border px-3 py-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-teal-500/20 ${
                              timelineFilter === "all"
                                ? "border-teal-500/40 bg-teal-600/20 text-teal-300"
                                : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200"
                            }`}
                          >
                            Show All
                          </button>
                          <button
                            type="button"
                            onClick={() => setTimelineFilter("income")}
                            className={`rounded-lg border px-3 py-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-500/20 ${
                              timelineFilter === "income"
                                ? "border-emerald-500/40 bg-emerald-600/20 text-emerald-300"
                                : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200"
                            }`}
                          >
                            Income Only
                          </button>
                          <button
                            type="button"
                            onClick={() => setTimelineFilter("expense")}
                            className={`rounded-lg border px-3 py-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-red-500/20 ${
                              timelineFilter === "expense"
                                ? "border-red-500/40 bg-red-600/20 text-red-300"
                                : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200"
                            }`}
                          >
                            Expenses Only
                          </button>
                        </div>

                        <div>
                          <label
                            htmlFor="timeline-search"
                            className="mb-2 block text-sm font-medium text-slate-300"
                          >
                            Search Events
                          </label>
                          <input
                            id="timeline-search"
                            type="search"
                            placeholder="Filter timeline events by name"
                            value={timelineSearch}
                            onChange={(e) => setTimelineSearch(e.target.value)}
                            className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-slate-600 transition focus:border-teal-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                          />
                        </div>
                      </div>
                    )}

                    {cashFlowProjection.rows.length > 0 && (
                      <ul className="space-y-2">
                        {visibleTimelineRows.length > 0 ? (
                          visibleTimelineRows.map(({ event, runningBalance }) => (
                            <li
                              key={event.id}
                              className={`flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm sm:grid sm:grid-cols-[5rem_1fr_auto_auto_auto] sm:items-center sm:gap-3 ${
                                event.type === "Income"
                                  ? "border-emerald-500/20 bg-emerald-500/5"
                                  : "border-red-500/20 bg-red-500/5"
                              }`}
                            >
                              <span className="text-slate-400">
                                {formatDueDate(event.date)}
                              </span>
                              <span
                                className={`font-medium ${
                                  event.type === "Income"
                                    ? "text-emerald-100"
                                    : "text-red-100"
                                }`}
                              >
                                {event.name}
                                {isPlannedPurchaseEvent(event.id) ? (
                                  <span className="ml-2 text-xs font-normal text-slate-500">
                                    Planned purchase
                                  </span>
                                ) : null}
                              </span>
                              <span
                                className={`font-semibold tabular-nums ${
                                  event.type === "Income"
                                    ? "text-emerald-300"
                                    : "text-red-300"
                                }`}
                              >
                                {event.type === "Income" ? "+" : "-"}${event.amount}
                              </span>
                              <span className="font-semibold tabular-nums text-teal-200">
                                ${runningBalance}
                              </span>
                              {isPlannedPurchaseEvent(event.id) ? (
                                <button
                                  type="button"
                                  onClick={() => removePlannedPurchase(event.id)}
                                  aria-label={`Delete planned purchase ${event.name}`}
                                  className="justify-self-start rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-200 sm:justify-self-end"
                                >
                                  Delete
                                </button>
                              ) : (
                                <span className="hidden sm:block" aria-hidden="true" />
                              )}
                            </li>
                          ))
                        ) : (
                          <li className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-6 text-center text-sm text-slate-500">
                            No events match your filters.
                          </li>
                        )}
                      </ul>
                    )}

                    <div
                      className={`rounded-xl border px-5 py-4 backdrop-blur-sm ${cashFlowStatusStyles[cashFlowProjection.status].border} ${cashFlowStatusStyles[cashFlowProjection.status].bg}`}
                    >
                      <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                        Timeline Status
                      </p>
                      <span
                        className={`mt-2 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${cashFlowStatusStyles[cashFlowProjection.status].badge} ${cashFlowStatusStyles[cashFlowProjection.status].badgeText}`}
                      >
                        {cashFlowStatusStyles[cashFlowProjection.status].message}
                      </span>
                    </div>
                  </div>
                )}
              </CollapsibleSection>

              <CollapsibleSection
                id="goals-and-planning"
                title="Goals & Planning"
                subtitle="Track savings goals and monthly financial planning"
                iconClassName="bg-violet-600/20 text-violet-400"
                isOpen={sectionOpen.goalsAndPlanning}
                onToggle={() => toggleSection("goalsAndPlanning")}
                icon={
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
                  </svg>
                }
              >
                <form
                        className="space-y-4"
                        onSubmit={(e) => {
                          e.preventDefault();
                          calculateSavingsGoal();
                        }}
                      >
                        <div>
                          <label
                            htmlFor="goal-name"
                            className="mb-2 block text-sm font-medium text-slate-300"
                          >
                            Goal Name
                          </label>
                          <input
                            id="goal-name"
                            type="text"
                            placeholder="Example: Emergency Fund"
                            value={goalName}
                            onChange={(e) => {
                              setGoalName(e.target.value);
                              setSavingsGoalCalculated(false);
                            }}
                            className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder:text-slate-600 transition focus:border-violet-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="goal-amount"
                            className="mb-2 block text-sm font-medium text-slate-300"
                          >
                            Goal Amount
                          </label>
                          <div className="relative">
                            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-500">
                              $
                            </span>
                            <input
                              id="goal-amount"
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0.00"
                              value={goalAmount}
                              onChange={(e) => {
                                setGoalAmount(e.target.value);
                                setSavingsGoalCalculated(false);
                              }}
                              className="block w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-9 pr-4 text-white placeholder:text-slate-600 transition focus:border-violet-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                            />
                          </div>
                        </div>

                        <div>
                          <label
                            htmlFor="current-saved"
                            className="mb-2 block text-sm font-medium text-slate-300"
                          >
                            Current Saved
                          </label>
                          <div className="relative">
                            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-500">
                              $
                            </span>
                            <input
                              id="current-saved"
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0.00"
                              value={currentSaved}
                              onChange={(e) => {
                                setCurrentSaved(e.target.value);
                                setSavingsGoalCalculated(false);
                              }}
                              className="block w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-9 pr-4 text-white placeholder:text-slate-600 transition focus:border-violet-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                            />
                          </div>
                        </div>

                        <div>
                          <label
                            htmlFor="monthly-contribution"
                            className="mb-2 block text-sm font-medium text-slate-300"
                          >
                            Monthly Contribution
                          </label>
                          <div className="relative">
                            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-500">
                              $
                            </span>
                            <input
                              id="monthly-contribution"
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0.00"
                              value={monthlyContribution}
                              onChange={(e) => {
                                setMonthlyContribution(e.target.value);
                                setSavingsGoalCalculated(false);
                              }}
                              className="block w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-9 pr-4 text-white placeholder:text-slate-600 transition focus:border-violet-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                            />
                          </div>
                        </div>

                        <button
                          type="submit"
                          className="w-full rounded-xl border border-violet-500/40 bg-violet-600/20 py-3.5 text-sm font-semibold text-violet-300 transition hover:border-violet-500/60 hover:bg-violet-600/30 focus:outline-none focus:ring-2 focus:ring-violet-500/20 active:bg-violet-600/40"
                        >
                          Track Goal
                        </button>
                      </form>

                      {savingsGoalCalculated && (() => {
                        const parsedGoalAmount = Number(goalAmount) || 0;
                        const parsedCurrentSaved = Number(currentSaved) || 0;
                        const parsedMonthlyContribution =
                          Number(monthlyContribution) || 0;
                        const amountRemaining = Math.max(
                          0,
                          parsedGoalAmount - parsedCurrentSaved,
                        );
                        const monthsUntilGoal =
                          parsedMonthlyContribution > 0
                            ? amountRemaining / parsedMonthlyContribution
                            : null;
                        const progressPercent =
                          parsedGoalAmount > 0
                            ? Math.min(
                                100,
                                (parsedCurrentSaved / parsedGoalAmount) * 100,
                              )
                            : 0;

                        return (
                          <div
                            role="status"
                            className="mt-5 rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 via-white/[0.02] to-purple-500/10 px-5 py-5 backdrop-blur-sm"
                          >
                            <dl className="space-y-3">
                              <div className="flex items-center justify-between gap-4 text-sm">
                                <dt className="text-slate-400">Goal Name</dt>
                                <dd className="font-semibold text-white">
                                  {goalName.trim() || "Untitled Goal"}
                                </dd>
                              </div>
                              <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-3 text-sm">
                                <dt className="text-slate-400">
                                  Amount Remaining
                                </dt>
                                <dd className="text-lg font-bold tabular-nums text-white">
                                  ${amountRemaining}
                                </dd>
                              </div>
                              <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-3 text-sm">
                                <dt className="text-slate-400">
                                  Months Until Goal
                                </dt>
                                <dd className="font-semibold tabular-nums text-violet-200">
                                  {monthsUntilGoal === null
                                    ? "—"
                                    : monthsUntilGoal === 0
                                      ? "0"
                                      : monthsUntilGoal % 1 === 0
                                        ? monthsUntilGoal
                                        : monthsUntilGoal.toFixed(1)}
                                </dd>
                              </div>
                            </dl>

                            <div className="mt-5 border-t border-white/10 pt-4">
                              <div className="mb-2 flex items-center justify-between text-xs">
                                <span className="text-slate-400">Progress</span>
                                <span className="font-medium tabular-nums text-violet-300">
                                  {Math.round(progressPercent)}%
                                </span>
                              </div>
                              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                                <div
                                  className="h-full rounded-full bg-violet-400 transition-all"
                                  style={{ width: `${progressPercent}%` }}
                                />
                              </div>
                              <p className="mt-2 text-xs text-slate-500">
                                ${parsedCurrentSaved} of ${parsedGoalAmount} saved
                              </p>
                            </div>
                          </div>
                        );
                      })()}

                      {savingsGoalCalculated && (() => {
                        const current = Number(currentSaved) || 0;
                        const goal = Number(goalAmount) || 0;
                        const monthly = Number(monthlyContribution) || 0;
                        const remaining = Math.max(0, goal - current);

                        if (monthly === 0) {
                          return (
                            <div
                              role="status"
                              className="mt-4 rounded-xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 via-white/[0.02] to-purple-500/10 px-5 py-5 backdrop-blur-sm"
                            >
                              <p className="text-xs font-medium uppercase tracking-wider text-indigo-300">
                                Coaching
                              </p>
                              <p className="mt-2 text-sm leading-relaxed text-indigo-100">
                                Start contributing monthly to reach your goal.
                              </p>
                            </div>
                          );
                        }

                        if (remaining === 0) {
                          return (
                            <div
                              role="status"
                              className="mt-4 rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-white/[0.02] to-teal-500/10 px-5 py-5 backdrop-blur-sm"
                            >
                              <p className="text-xs font-medium uppercase tracking-wider text-emerald-300">
                                Coaching
                              </p>
                              <p className="mt-2 text-sm leading-relaxed text-emerald-100">
                                You&apos;ve already reached your ${goal} goal.
                                Keep saving to build beyond it.
                              </p>
                            </div>
                          );
                        }

                        const monthsToGoal = remaining / monthly;
                        const displayMonths =
                          monthsToGoal % 1 === 0
                            ? monthsToGoal
                            : monthsToGoal.toFixed(1);

                        return (
                          <div
                            role="status"
                            className="mt-4 rounded-xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 via-white/[0.02] to-purple-500/10 px-5 py-5 backdrop-blur-sm"
                          >
                            <p className="text-xs font-medium uppercase tracking-wider text-indigo-300">
                              Coaching
                            </p>
                            <p className="mt-2 text-sm leading-relaxed text-indigo-100">
                              You are saving ${monthly}/month. You will reach
                              your ${goal} goal in {displayMonths} months.
                            </p>
                          </div>
                        );
                      })()}

                <div className="mt-8 border-t border-white/10 pt-6">
                  <h4 className="mb-3 text-sm font-semibold text-emerald-300">
                    Monthly Planning
                  </h4>
                  <form
                    className="space-y-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      calculateMonthlyBuffer();
                    }}
                  >
                    <div>
                      <label
                        htmlFor="monthly-income"
                        className="mb-2 block text-sm font-medium text-slate-300"
                      >
                        Monthly Income
                      </label>
                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-500">
                          $
                        </span>
                        <input
                          id="monthly-income"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={monthlyIncome}
                          onChange={(e) => {
                            setMonthlyIncome(e.target.value);
                            setMonthlyBufferCalculated(false);
                          }}
                          className="block w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-9 pr-4 text-white placeholder:text-slate-600 transition focus:border-emerald-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="monthly-expenses"
                        className="mb-2 block text-sm font-medium text-slate-300"
                      >
                        Monthly Expenses
                      </label>
                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-500">
                          $
                        </span>
                        <input
                          id="monthly-expenses"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={monthlyExpenses}
                          onChange={(e) => {
                            setMonthlyExpenses(e.target.value);
                            setMonthlyBufferCalculated(false);
                          }}
                          className="block w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-9 pr-4 text-white placeholder:text-slate-600 transition focus:border-emerald-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="emergency-current-savings"
                        className="mb-2 block text-sm font-medium text-slate-300"
                      >
                        Current Savings
                      </label>
                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-500">
                          $
                        </span>
                        <input
                          id="emergency-current-savings"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={emergencyCurrentSavings}
                          onChange={(e) => {
                            setEmergencyCurrentSavings(e.target.value);
                            setMonthlyBufferCalculated(false);
                          }}
                          className="block w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-9 pr-4 text-white placeholder:text-slate-600 transition focus:border-emerald-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full rounded-xl border border-emerald-500/40 bg-emerald-600/20 py-3.5 text-sm font-semibold text-emerald-300 transition hover:border-emerald-500/60 hover:bg-emerald-600/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 active:bg-emerald-600/40"
                    >
                      Calculate Monthly Buffer
                    </button>
                  </form>

                  {monthlyBufferCalculated && (() => {
                    const income = Number(monthlyIncome) || 0;
                    const expenses = Number(monthlyExpenses) || 0;
                    const savings = Number(emergencyCurrentSavings) || 0;
                    const monthlySurplus = income - expenses;
                    const isDeficit = monthlySurplus < 0;
                    const monthsCovered =
                      expenses > 0 ? savings / expenses : null;

                    return (
                      <div className="mt-5 space-y-4">
                        <div
                          role="status"
                          className={`rounded-xl border px-5 py-5 backdrop-blur-sm ${
                            isDeficit
                              ? "border-red-500/30 bg-gradient-to-br from-red-500/10 via-white/[0.02] to-red-500/5"
                              : "border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-white/[0.02] to-teal-500/10"
                          }`}
                        >
                          <dl className="space-y-3">
                            <div className="flex items-center justify-between gap-4 text-sm">
                              <dt className="text-slate-400">Monthly Surplus</dt>
                              <dd
                                className={`text-lg font-bold tabular-nums ${
                                  isDeficit ? "text-red-300" : "text-emerald-200"
                                }`}
                              >
                                {isDeficit
                                  ? `-$${Math.abs(monthlySurplus)}`
                                  : `$${monthlySurplus}`}
                              </dd>
                            </div>
                          </dl>
                        </div>

                        {monthsCovered === null ? (
                          <div
                            role="status"
                            className="rounded-xl border border-white/10 bg-white/[0.03] px-5 py-5 text-sm text-slate-400"
                          >
                            Enter monthly expenses above zero to calculate
                            emergency fund coverage.
                          </div>
                        ) : (
                          (() => {
                            const statusStyles =
                              getEmergencyFundStatus(monthsCovered);
                            const displayMonths =
                              monthsCovered % 1 === 0
                                ? monthsCovered
                                : monthsCovered.toFixed(1);

                            return (
                              <div
                                role="status"
                                className={`rounded-xl border px-5 py-5 backdrop-blur-sm ${statusStyles.border} ${statusStyles.bg}`}
                              >
                                <dl className="space-y-3">
                                  <div className="flex items-center justify-between gap-4 text-sm">
                                    <dt className="text-slate-400">
                                      Emergency Fund Coverage
                                    </dt>
                                    <dd
                                      className={`text-lg font-bold tabular-nums ${statusStyles.value}`}
                                    >
                                      {displayMonths}{" "}
                                      {monthsCovered === 1 ? "Month" : "Months"}
                                    </dd>
                                  </div>
                                </dl>
                                <div className="mt-4 border-t border-white/10 pt-4">
                                  <span
                                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusStyles.badge} ${statusStyles.badgeText}`}
                                  >
                                    {statusStyles.status}
                                  </span>
                                </div>
                              </div>
                            );
                          })()
                        )}
                      </div>
                    );
                  })()}
                </div>

              </CollapsibleSection>

              <CollapsibleSection
                id="spending-decision"
                title="Spending Decision"
                subtitle="Your personal spending coach"
                iconClassName="bg-blue-600/20 text-blue-400"
                isOpen={sectionOpen.spendingDecision}
                onToggle={() => toggleSection("spendingDecision")}
                icon={
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <path d="M9 12l2 2 4-4" />
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                }
              >
                <p className="mb-5 text-sm leading-relaxed text-slate-400">
                  Thinking about a purchase? Tell me what you&apos;re considering
                  and I&apos;ll check it against your Safe To Spend — before you
                  buy.
                </p>

                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitSpendingDecision();
                  }}
                >
                  <div>
                    <label
                      htmlFor="purchase-type"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Purchase Type
                    </label>
                    <select
                      id="purchase-type"
                      value={purchaseType}
                      onChange={(e) =>
                        setPurchaseType(e.target.value as PurchaseType)
                      }
                      className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white transition focus:border-blue-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    >
                      <option value="One-Time Purchase">One-Time Purchase</option>
                      <option value="Monthly Subscription">
                        Monthly Subscription
                      </option>
                      <option value="Weekly Habit">Weekly Habit</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="purchase-name"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Purchase Name
                    </label>
                    <input
                      id="purchase-name"
                      type="text"
                      placeholder="Example: New gym membership"
                      value={purchaseName}
                      onChange={(e) => setPurchaseName(e.target.value)}
                      className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder:text-slate-600 transition focus:border-blue-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="purchase-cost"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Purchase Cost
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-500">
                        $
                      </span>
                      <input
                        id="purchase-cost"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={purchaseAmount}
                        onChange={(e) => setPurchaseAmount(e.target.value)}
                        className="block w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-9 pr-4 text-white placeholder:text-slate-600 transition focus:border-blue-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                    {purchaseType === "Weekly Habit" && purchaseAmount !== "" ? (
                      <p className="mt-2 text-xs text-slate-500">
                        Monthly equivalent:{" "}
                        {getWeeklyHabitMonthlyEquivalentLabel(
                          Number(purchaseAmount) || 0,
                        )}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <label
                      htmlFor="purchase-date"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Purchase Date
                    </label>
                    <input
                      id="purchase-date"
                      type="date"
                      value={purchaseDate}
                      onChange={(e) => setPurchaseDate(e.target.value)}
                      className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white transition focus:border-blue-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-blue-500/20 [color-scheme:dark]"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full rounded-xl border border-blue-500/50 bg-blue-600/30 py-4 text-base font-bold text-blue-100 transition hover:border-blue-400/60 hover:bg-blue-600/40 focus:outline-none focus:ring-2 focus:ring-blue-500/30 active:bg-blue-600/50"
                  >
                    Can I Afford This?
                  </button>
                </form>

                {!hasDashboardData ? (
                  <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-400">
                    Add bills, paychecks, or a checking balance so I can
                    calculate your Safe To Spend.
                  </p>
                ) : null}

                {spendingDecisionResult ? (
                  <div
                    role="status"
                    className={`mt-6 rounded-xl border px-5 py-5 ${
                      spendingVerdictStyles[spendingDecisionResult.verdict].border
                    } ${spendingVerdictStyles[spendingDecisionResult.verdict].bg}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm text-slate-400">
                          {spendingDecisionResult.purchaseName}
                        </p>
                        <p className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-500">
                          Coach Verdict
                        </p>
                        <p
                          className={`mt-0.5 text-xl font-bold ${
                            spendingVerdictStyles[spendingDecisionResult.verdict]
                              .title
                          }`}
                        >
                          {getVerdictDisplayLabel(spendingDecisionResult.verdict)}
                        </p>
                      </div>
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-semibold ${
                          spendingVerdictStyles[spendingDecisionResult.verdict]
                            .badge
                        } ${
                          spendingVerdictStyles[spendingDecisionResult.verdict]
                            .badgeText
                        }`}
                      >
                        {spendingDecisionResult.purchaseType}
                      </span>
                    </div>

                    {spendingDecisionResult.monthlyEquivalentLabel ? (
                      <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300">
                        <span className="font-medium text-slate-400">
                          Monthly equivalent:{" "}
                        </span>
                        {spendingDecisionResult.monthlyEquivalentLabel}
                      </p>
                    ) : null}

                    <dl className="mt-4 space-y-2.5 border-t border-white/10 pt-4">
                      <div className="flex items-center justify-between gap-4 text-sm">
                        <dt className="text-slate-400">Purchase Cost</dt>
                        <dd className="font-semibold tabular-nums text-white">
                          ${spendingDecisionResult.cost}
                          {spendingDecisionResult.purchaseType ===
                          "Weekly Habit"
                            ? "/week"
                            : spendingDecisionResult.purchaseType ===
                                "Monthly Subscription"
                              ? "/month"
                              : ""}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4 text-sm sm:text-base">
                        <dt className="text-slate-400">Available by Purchase Date</dt>
                        <dd className="font-semibold tabular-nums text-white">
                          ${spendingDecisionResult.availableByPurchaseDate}
                        </dd>
                      </div>
                      {spendingDecisionResult.verdict === "Not Affordable" ||
                      spendingDecisionResult.verdict === "Not Affordable Today" ? (
                        <div className="flex items-center justify-between gap-4 text-sm sm:text-base">
                          <dt className="text-red-400">Short by</dt>
                          <dd className="font-semibold tabular-nums text-red-300">
                            $
                            {Math.max(
                              0,
                              spendingDecisionResult.purchaseCost -
                                spendingDecisionResult.availableByPurchaseDate,
                            )}
                          </dd>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-4 text-sm sm:text-base">
                          <dt className="text-slate-400">
                            {spendingDecisionResult.verdict === "Wait Until Payday"
                              ? "Projected Remaining Balance"
                              : "Remaining Safe To Spend"}
                          </dt>
                          <dd className="font-semibold tabular-nums text-white">
                            ${spendingDecisionResult.remainingSafeToSpend}
                          </dd>
                        </div>
                      )}
                    </dl>

                    {spendingDecisionResult.usedTodayForAnalysisOnly ? (
                      <p className="mt-4 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-sm text-yellow-200/90">
                        No purchase date selected. Using today for analysis only.
                      </p>
                    ) : null}

                    <p className="mt-4 border-t border-white/10 pt-4 text-sm leading-relaxed whitespace-pre-line text-slate-300">
                      {spendingDecisionResult.explanation}
                    </p>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={planThisPurchase}
                        disabled={
                          purchaseDate.trim() === "" || isCurrentDecisionOnTimeline
                        }
                        className="w-full rounded-xl border border-emerald-500/40 bg-emerald-600/20 py-3 text-sm font-semibold text-emerald-300 transition hover:border-emerald-500/60 hover:bg-emerald-600/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 active:bg-emerald-600/40 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isCurrentDecisionOnTimeline
                          ? "✅ Planned on Timeline"
                          : "✅ Plan This Purchase"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelSpendingDecision}
                        className="w-full rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-white/10 active:bg-white/10"
                      >
                        ❌ Cancel
                      </button>
                    </div>
                    {purchaseDate.trim() === "" ? (
                      <p className="mt-3 text-xs text-slate-500">
                        Select a purchase date to add this to your timeline.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </CollapsibleSection>

            </div>
          </section>
        </div>

        {/* Features */}
        <section className="mt-20 grid gap-6 sm:grid-cols-3 sm:gap-8">
          {[
            {
              icon: (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
                />
              ),
              title: "Instant decisions",
              description:
                "Evaluate any purchase in seconds — no manual math required.",
            },
            {
              icon: (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"
                />
              ),
              title: "One source of truth",
              description:
                "Bills, paychecks, and goals feed every decision automatically.",
            },
            {
              icon: (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                />
              ),
              title: "Private by design",
              description:
                "Your numbers stay on your device. Nothing is stored or shared.",
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-white/20 hover:bg-white/[0.05]"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600/15 text-blue-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="1.5"
                  stroke="currentColor"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  {feature.icon}
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-white">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                {feature.description}
              </p>
            </div>
          ))}
        </section>
      </main>

      {profileModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm"
          onClick={() => setProfileModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-modal-title"
            className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl shadow-black/40"
            onClick={(e) => e.stopPropagation()}
          >
            {profileModal === "account" ? (
              <>
                <h2
                  id="profile-modal-title"
                  className="text-lg font-semibold text-white"
                >
                  My Account
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Your name appears in the header and dashboard welcome.
                </p>
                <form
                  className="mt-5 space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveProfile();
                  }}
                >
                  <div>
                    <label
                      htmlFor="modal-profile-name"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Name
                    </label>
                    <input
                      id="modal-profile-name"
                      type="text"
                      placeholder="Example: Miguel"
                      value={profile.name}
                      onChange={(e) => {
                        setProfile((prev) => ({ ...prev, name: e.target.value }));
                        setProfileMessage("");
                      }}
                      className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder:text-slate-600 transition focus:border-cyan-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="modal-profile-email"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Email <span className="text-slate-500">(optional)</span>
                    </label>
                    <input
                      id="modal-profile-email"
                      type="email"
                      placeholder="Example: you@email.com"
                      value={profile.email}
                      onChange={(e) => {
                        setProfile((prev) => ({ ...prev, email: e.target.value }));
                        setProfileMessage("");
                      }}
                      className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder:text-slate-600 transition focus:border-cyan-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                    />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button
                      type="submit"
                      className="flex-1 rounded-xl border border-cyan-500/40 bg-cyan-600/20 py-3 text-sm font-semibold text-cyan-300 transition hover:border-cyan-500/60 hover:bg-cyan-600/30"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setProfileModal(null)}
                      className="flex-1 rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-semibold text-slate-300 transition hover:bg-white/[0.08]"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <h2
                  id="profile-modal-title"
                  className="text-lg font-semibold text-white"
                >
                  Settings
                </h2>
                <div className="mt-5 space-y-4 text-sm text-slate-400">
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                    <p className="font-medium text-slate-200">Local storage</p>
                    <p className="mt-1 leading-relaxed">
                      Your financial data stays on this device. Nothing is sent
                      to a server or shared with anyone.
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                    <p className="font-medium text-slate-200">Data backup</p>
                    <p className="mt-1 leading-relaxed">
                      Use Export Data from the profile menu to download a backup
                      of your bills, paychecks, goals, and profile.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setProfileModal(null)}
                  className="mt-5 w-full rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-semibold text-slate-300 transition hover:bg-white/[0.08]"
                >
                  Close
                </button>
              </>
            )}

            {profileMessage ? (
              <p
                role="status"
                className="mt-4 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-200"
              >
                {profileMessage}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <footer className="relative z-10 border-t border-white/10 py-8">
        <p className="text-center text-xs text-slate-600">
          © {new Date().getFullYear()} Financial Confidence. Built for smarter
          spending decisions.
        </p>
      </footer>
    </div>
  );
}
