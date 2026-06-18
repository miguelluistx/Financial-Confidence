"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type PlannedBill = {
  id: string;
  name: string;
  amount: number;
  dueDate: string;
};

type BillFormType = "one-time" | "recurring";

type RecurringFrequency = "Monthly" | "Weekly" | "Biweekly";

type SpendingVerdict =
  | "Affordable Now"
  | "Wait Until Payday"
  | "Not Affordable Today"
  | "Not Affordable";

type PurchaseType = "One-Time" | "Daily" | "Weekly" | "Monthly";

type TimelineEventSource =
  | { kind: "bill"; billId: string }
  | { kind: "paycheck"; paycheckId: string }
  | { kind: "recurring"; billId: string; occurrenceDate: string }
  | { kind: "manual"; eventId: string }
  | { kind: "planned-purchase"; eventId: string };

type ConfidenceScoreLabel =
  | "Excellent"
  | "Good"
  | "Caution"
  | "Risky"
  | "Dangerous";

type SpendingDecisionResult = {
  verdict: SpendingVerdict;
  purchaseName: string;
  cost: number;
  purchaseType: PurchaseType;
  monthlyImpact: number;
  annualImpact: number;
  purchaseCost: number;
  currentSafeToSpend: number;
  availableByPurchaseDate: number;
  remainingSafeToSpend: number;
  safeToSpendAfterPurchase: number;
  projectedBalance: number;
  projectedShortfall: number | null;
  evaluationDate: string;
  usedTodayForAnalysisOnly: boolean;
  explanation: string;
  impactSummary: string | null;
  confidenceScore: number;
  confidenceScoreLabel: ConfidenceScoreLabel;
  mainAnswer: string;
  why: string;
  goalImpact: string | null;
  recommendation: string;
  /** @deprecated Use impactSummary */
  monthlyEquivalentLabel?: string | null;
};

type UserProfile = {
  name: string;
  email: string;
};

type SavingsGoal = {
  id: string;
  name: string;
  targetAmount: number;
  currentSaved: number;
  isPrimary: boolean;
};

const DEFAULT_PROFILE: UserProfile = {
  name: "",
  email: "",
};

function getGoalProgressPercent(goal: SavingsGoal): number {
  if (goal.targetAmount <= 0) return 0;

  return Math.min(
    100,
    Math.round((goal.currentSaved / goal.targetAmount) * 100),
  );
}

function toTitleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function formatGoalName(name: string): string {
  return toTitleCase(name);
}

function isGoalComplete(goal: SavingsGoal): boolean {
  return goal.targetAmount > 0 && goal.currentSaved >= goal.targetAmount;
}

function getRelativePaydayLabel(dateString: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [year, month, day] = dateString.split("-").map(Number);
  const payday = new Date(year, month - 1, day);
  payday.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (payday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays > 1) return `In ${diffDays} Days`;

  return formatDueDate(dateString);
}

function getPrimarySavingsGoal(goals: SavingsGoal[]): SavingsGoal | null {
  return goals.find((goal) => goal.isPrimary) ?? null;
}

function migrateSavingsGoals(
  saved: PersistedAppData & {
    goalName?: string;
    goalAmount?: string;
    currentSaved?: string;
    coachSavingsGoal?: string;
    coachCurrentSavings?: string;
  },
): SavingsGoal[] {
  if (saved.savingsGoals?.length) {
    return saved.savingsGoals.map((goal) => ({
      id: goal.id,
      name: formatGoalName(goal.name),
      targetAmount: goal.targetAmount,
      currentSaved: goal.currentSaved,
      isPrimary: goal.isPrimary,
    }));
  }

  const name = saved.goalName?.trim() ?? "";
  const targetAmount =
    Number(saved.goalAmount || saved.coachSavingsGoal) || 0;
  const currentSaved =
    Number(saved.currentSaved || saved.coachCurrentSavings) || 0;

  if (!name || targetAmount <= 0) {
    return [];
  }

  return [
    {
      id: crypto.randomUUID(),
      name: toTitleCase(name),
      targetAmount,
      currentSaved,
      isPrimary: true,
    },
  ];
}

function normalizePurchaseType(value: string | undefined): PurchaseType {
  switch (value) {
    case "One-Time":
    case "Daily":
    case "Weekly":
    case "Monthly":
      return value;
    case "One-Time Purchase":
      return "One-Time";
    case "Monthly Subscription":
      return "Monthly";
    case "Weekly Habit":
      return "Weekly";
    default:
      return "One-Time";
  }
}

function getSpendingDecisionMonthlyImpact(
  cost: number,
  purchaseType: PurchaseType,
): number {
  switch (purchaseType) {
    case "One-Time":
      return cost;
    case "Daily":
      return cost * 30;
    case "Weekly":
      return cost * 4;
    case "Monthly":
      return cost;
  }
}

function getPurchaseAnnualImpact(
  cost: number,
  purchaseType: PurchaseType,
): number {
  switch (purchaseType) {
    case "Daily":
      return cost * 365;
    case "Weekly":
      return cost * 52;
    case "Monthly":
      return cost * 12;
    case "One-Time":
      return cost;
  }
}

function getPurchaseImpactSummary(
  cost: number,
  purchaseType: PurchaseType,
): string | null {
  switch (purchaseType) {
    case "Daily": {
      const monthly = cost * 30;
      const annual = cost * 365;
      return `$${cost}/day equals about $${monthly.toLocaleString()}/month and $${annual.toLocaleString()}/year.`;
    }
    case "Weekly": {
      const monthly = cost * 4;
      const annual = cost * 52;
      return `$${cost}/week equals about $${monthly.toLocaleString()}/month and $${annual.toLocaleString()}/year.`;
    }
    case "Monthly": {
      const annual = cost * 12;
      return `$${cost}/month equals $${cost.toLocaleString()}/month and $${annual.toLocaleString()}/year.`;
    }
    case "One-Time":
      return null;
  }
}

function getPurchaseFrequencyLabel(
  cost: number,
  purchaseType: PurchaseType,
): string | null {
  return getPurchaseImpactSummary(cost, purchaseType);
}

function getConfidenceScoreLabel(score: number): ConfidenceScoreLabel {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 60) return "Caution";
  if (score >= 40) return "Risky";
  return "Dangerous";
}

function calculateFinancialConfidenceScore(
  verdict: SpendingVerdict,
  currentSafeToSpend: number,
  safeToSpendAfterPurchase: number,
): { score: number; label: ConfidenceScoreLabel } {
  const tightThreshold = Math.max(50, currentSafeToSpend * 0.1);
  let score: number;

  switch (verdict) {
    case "Affordable Now": {
      if (currentSafeToSpend <= 0) {
        score = 92;
      } else if (safeToSpendAfterPurchase <= tightThreshold) {
        score = 68;
      } else {
        const bufferRatio = safeToSpendAfterPurchase / currentSafeToSpend;
        if (bufferRatio >= 0.6) score = 95;
        else if (bufferRatio >= 0.35) score = 88;
        else if (bufferRatio >= 0.15) score = 80;
        else score = 76;
      }
      break;
    }
    case "Wait Until Payday":
      score = 66;
      break;
    case "Not Affordable Today":
      score = 48;
      break;
    case "Not Affordable":
      score = 22;
      break;
  }

  const roundedScore = Math.min(100, Math.max(0, Math.round(score)));
  return {
    score: roundedScore,
    label: getConfidenceScoreLabel(roundedScore),
  };
}

function getSpendingGoalAfterPurchaseStatus(
  verdict: SpendingVerdict,
  currentSafeToSpend: number,
  safeToSpendAfterPurchase: number,
): "Still On Track" | "May slow progress toward this goal" {
  const isShortfall =
    verdict === "Not Affordable" || verdict === "Not Affordable Today";
  const isWait = verdict === "Wait Until Payday";
  const tightThreshold = Math.max(50, currentSafeToSpend * 0.1);
  const isTight =
    !isShortfall &&
    !isWait &&
    safeToSpendAfterPurchase <= tightThreshold &&
    safeToSpendAfterPurchase >= 0;

  if (isShortfall || isWait || isTight) {
    return "May slow progress toward this goal";
  }

  return "Still On Track";
}

function getSpendingGoalImpact(
  verdict: SpendingVerdict,
  currentSafeToSpend: number,
  safeToSpendAfterPurchase: number,
  primaryGoal: SavingsGoal | null,
): string | null {
  if (!primaryGoal) return null;

  const goalName = formatGoalName(primaryGoal.name);
  const isShortfall =
    verdict === "Not Affordable" || verdict === "Not Affordable Today";
  const tightThreshold = Math.max(50, currentSafeToSpend * 0.1);
  const isTight =
    !isShortfall &&
    safeToSpendAfterPurchase <= tightThreshold &&
    safeToSpendAfterPurchase >= 0;

  if (isShortfall) {
    return `This could delay progress toward ${goalName}.`;
  }

  if (isTight || verdict === "Wait Until Payday") {
    return "May slow progress toward this goal";
  }

  return "Still On Track";
}

function buildSpendingCoachOutput(params: {
  verdict: SpendingVerdict;
  purchaseType: PurchaseType;
  shortBy: number;
  beforeNextIncomeHasShortfall: boolean;
  currentSafeToSpend: number;
  safeToSpendAfterPurchase: number;
  primaryGoal: SavingsGoal | null;
}): {
  mainAnswer: string;
  why: string;
  goalImpact: string | null;
  recommendation: string;
} {
  const {
    verdict,
    purchaseType,
    shortBy,
    beforeNextIncomeHasShortfall,
    currentSafeToSpend,
    safeToSpendAfterPurchase,
    primaryGoal,
  } = params;
  const isShortfall =
    verdict === "Not Affordable" || verdict === "Not Affordable Today";
  const isWait = verdict === "Wait Until Payday";
  const tightThreshold = Math.max(50, currentSafeToSpend * 0.1);
  const isTight =
    !isShortfall &&
    !isWait &&
    safeToSpendAfterPurchase <= tightThreshold &&
    safeToSpendAfterPurchase >= 0;

  let mainAnswer: string;
  if (isShortfall) {
    mainAnswer = "No, this creates a cash flow risk.";
  } else if (isWait || isTight) {
    mainAnswer = "Proceed with caution.";
  } else {
    mainAnswer = "Yes, this looks affordable.";
  }

  let why: string;
  if (isShortfall) {
    if (beforeNextIncomeHasShortfall) {
      why = `This purchase would push your balance below $0 before your next paycheck. You would be short by about $${shortBy.toLocaleString()}.`;
    } else {
      why = `Even after upcoming income, this purchase would leave your cash flow negative. You would be short by about $${shortBy.toLocaleString()}.`;
    }
  } else if (isWait) {
    why =
      "You do not have enough available on the purchase date, but your cash flow should recover after your next paycheck if you wait.";
  } else if (isTight) {
    why =
      "You can cover this purchase, but it would leave very little room in your Safe To Spend for other expenses.";
  } else {
    why =
      "This purchase fits within your available cash and keeps your balance positive through upcoming bills and income.";
  }

  const goalImpact = getSpendingGoalImpact(
    verdict,
    currentSafeToSpend,
    safeToSpendAfterPurchase,
    primaryGoal,
  );

  let recommendation: string;
  if (!isShortfall && !isWait && !isTight) {
    recommendation = "Safe to plan.";
  } else if (isWait) {
    recommendation = "Wait until after your next payday.";
  } else if (isShortfall) {
    recommendation =
      purchaseType !== "One-Time"
        ? "Consider making this a one-time purchase instead of recurring."
        : "Reduce the purchase amount.";
  } else if (isTight) {
    recommendation =
      purchaseType !== "One-Time"
        ? "Consider making this a one-time purchase instead of recurring."
        : "Safe to plan.";
  } else {
    recommendation = "Reduce the purchase amount.";
  }

  return { mainAnswer, why, goalImpact, recommendation };
}

function parseTimelineEventSource(eventId: string): TimelineEventSource | null {
  if (eventId.startsWith("bill-")) {
    return { kind: "bill", billId: eventId.slice("bill-".length) };
  }

  if (eventId.startsWith("paycheck-")) {
    return { kind: "paycheck", paycheckId: eventId.slice("paycheck-".length) };
  }

  if (eventId.startsWith("planned-purchase-")) {
    return { kind: "planned-purchase", eventId };
  }

  if (eventId.startsWith("recurring-")) {
    const remainder = eventId.slice("recurring-".length);
    const occurrenceDate = remainder.slice(-10);
    const billId = remainder.slice(0, -11);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate) || !billId) {
      return null;
    }

    return { kind: "recurring", billId, occurrenceDate };
  }

  return { kind: "manual", eventId };
}

function isPlannedPurchaseEvent(eventId: string): boolean {
  return eventId.startsWith("planned-purchase-");
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
  primaryGoal: SavingsGoal | null = null,
): SpendingDecisionResult {
  const purchaseCost = getSpendingDecisionMonthlyImpact(cost, purchaseType);
  const annualImpact = getPurchaseAnnualImpact(cost, purchaseType);
  const impactSummary = getPurchaseImpactSummary(cost, purchaseType);
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
  let safeToSpendAfterPurchase: number;

  if (isPurchaseToday && purchaseCost > checkingBalance) {
    verdict = "Not Affordable Today";
    remainingSafeToSpend = 0;
    safeToSpendAfterPurchase = 0;
    projectedShortfall = Math.abs(Math.min(0, beforeNextIncome.lowestBalance));
    explanation = `You're short by $${shortBy} for this purchase.\n\nBuying this today would create a shortfall before your next paycheck.`;
  } else if (canCoverPurchaseToday && safeBeforeNextPaycheck) {
    verdict = "Affordable Now";
    safeToSpendAfterPurchase = Math.max(0, safeToSpend - purchaseCost);
    remainingSafeToSpend = safeToSpendAfterPurchase;
    explanation =
      "This purchase fits your cash flow and keeps your balance above $0.";
  } else if (!fullSimulation.hasShortfall && projectedBalance >= 0) {
    verdict = "Wait Until Payday";
    remainingSafeToSpend = projectedBalance;
    safeToSpendAfterPurchase = 0;
    explanation = `You're short by $${shortBy} for this purchase.\n\nAfter your upcoming paycheck and bills, you would have about $${projectedBalance} left. Waiting until payday is recommended.`;
  } else {
    verdict = "Not Affordable";
    projectedShortfall = Math.abs(Math.min(0, fullSimulation.lowestBalance));
    remainingSafeToSpend = 0;
    safeToSpendAfterPurchase = 0;
    const timelineShort = projectedShortfall ?? shortBy;
    if (isBeforeNextPaycheck) {
      explanation = `You're short by $${shortBy} for this purchase.\n\nBuying this today would create a shortfall before your next paycheck.`;
    } else {
      explanation = `You're short by $${shortBy} for this purchase.\n\nEven after upcoming income, this purchase is still $${timelineShort} short.`;
    }
  }

  const coach = buildSpendingCoachOutput({
    verdict,
    purchaseType,
    shortBy,
    beforeNextIncomeHasShortfall: beforeNextIncome.hasShortfall,
    currentSafeToSpend: safeToSpend,
    safeToSpendAfterPurchase,
    primaryGoal,
  });
  const confidence = calculateFinancialConfidenceScore(
    verdict,
    safeToSpend,
    safeToSpendAfterPurchase,
  );

  return {
    verdict,
    purchaseName,
    cost,
    purchaseType,
    monthlyImpact: purchaseCost,
    annualImpact,
    purchaseCost,
    currentSafeToSpend: safeToSpend,
    availableByPurchaseDate: balanceAvailableForPurchase,
    remainingSafeToSpend,
    safeToSpendAfterPurchase,
    projectedBalance,
    projectedShortfall,
    evaluationDate,
    usedTodayForAnalysisOnly,
    explanation,
    impactSummary,
    confidenceScore: confidence.score,
    confidenceScoreLabel: confidence.label,
    mainAnswer: coach.mainAnswer,
    why: coach.why,
    goalImpact: coach.goalImpact,
    recommendation: coach.recommendation,
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
  const cost = result.cost;
  const monthlyImpact =
    result.monthlyImpact ??
    getSpendingDecisionMonthlyImpact(cost, purchaseType);
  const annualImpact =
    result.annualImpact ?? getPurchaseAnnualImpact(cost, purchaseType);
  const purchaseCost = result.purchaseCost ?? monthlyImpact;
  const currentSafeToSpend = result.currentSafeToSpend ?? 0;
  const safeToSpendAfterPurchase =
    result.safeToSpendAfterPurchase ??
    (verdict === "Not Affordable" || verdict === "Not Affordable Today"
      ? 0
      : verdict === "Wait Until Payday"
        ? 0
        : Math.max(0, currentSafeToSpend - purchaseCost));
  const shortBy = Math.max(0, purchaseCost - (result.availableByPurchaseDate ?? 0));

  const coach = buildSpendingCoachOutput({
    verdict,
    purchaseType,
    shortBy,
    beforeNextIncomeHasShortfall:
      verdict === "Not Affordable Today" || verdict === "Not Affordable",
    currentSafeToSpend,
    safeToSpendAfterPurchase,
    primaryGoal: null,
  });
  const confidence = calculateFinancialConfidenceScore(
    verdict,
    currentSafeToSpend,
    safeToSpendAfterPurchase,
  );

  return {
    verdict,
    purchaseName: result.purchaseName,
    cost,
    purchaseType,
    monthlyImpact,
    annualImpact,
    purchaseCost,
    currentSafeToSpend,
    availableByPurchaseDate:
      result.availableByPurchaseDate ?? result.currentSafeToSpend ?? 0,
    remainingSafeToSpend: result.remainingSafeToSpend,
    safeToSpendAfterPurchase,
    projectedBalance: result.projectedBalance ?? result.remainingSafeToSpend,
    projectedShortfall: result.projectedShortfall ?? null,
    evaluationDate: result.evaluationDate ?? toISODate(new Date()),
    usedTodayForAnalysisOnly: result.usedTodayForAnalysisOnly ?? false,
    explanation:
      result.explanation ||
      "Even after upcoming income, this purchase would create a cash shortfall and should be avoided for now.",
    impactSummary:
      result.impactSummary ??
      result.monthlyEquivalentLabel ??
      getPurchaseImpactSummary(cost, purchaseType),
    confidenceScore: confidence.score,
    confidenceScoreLabel: confidence.label,
    mainAnswer: coach.mainAnswer,
    why: coach.why,
    goalImpact: coach.goalImpact,
    recommendation: coach.recommendation,
  };
}

type RecurringBill = {
  id: string;
  name: string;
  amount: number;
  dueDay: number;
  frequency: RecurringFrequency;
  firstDueDate?: string;
  skippedDates?: string[];
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
      .filter(
        (date) =>
          date <= horizonISO && !bill.skippedDates?.includes(date),
      )
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

function getNextWeekdayISO(weekday: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + ((weekday - date.getDay() + 7) % 7));
  return toISODate(date);
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

  if (bill.frequency === "Biweekly" && bill.firstDueDate) {
    return `First due ${formatDueDate(bill.firstDueDate)}`;
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

  if (bill.frequency === "Biweekly" && bill.firstDueDate) {
    const [year, month, day] = bill.firstDueDate.split("-").map(Number);
    const occurrence = new Date(year, month - 1, day);
    occurrence.setHours(0, 0, 0, 0);

    while (occurrence < startDay) {
      occurrence.setDate(occurrence.getDate() + 14);
    }

    while (occurrence <= endDay) {
      dates.push(toISODate(occurrence));
      occurrence.setDate(occurrence.getDate() + 14);
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
): {
  status: "Healthy" | "Shortfall Expected";
  headline: string;
  detail: string;
} {
  if (!hasShortfall) {
    return {
      status: "Healthy",
      headline: "You're on track.",
      detail:
        "Cash flow remains positive through upcoming bills and income.",
    };
  }

  const subtitle = getDashboardCashFlowSubtitle(rows, todayISO, shortfallCause);

  return {
    status: "Shortfall Expected",
    headline: "Your cash flow needs attention.",
    detail: `${subtitle}. Remove or reduce planned purchases to avoid a cash shortfall.`,
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
  savingsGoals: SavingsGoal[];
  goalName: string;
  goalAmount: string;
  currentSaved: string;
  monthlyContribution: string;
  savingsGoalCalculated: boolean;
  plannedBills: PlannedBill[];
  billName: string;
  billAmount: string;
  billDueDate: string;
  billFormType?: BillFormType;
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
  recurringFirstDueDate?: string;
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

const confidenceScoreStyles: Record<
  ConfidenceScoreLabel,
  { score: string; label: string }
> = {
  Excellent: {
    score: "text-emerald-200",
    label: "text-emerald-300",
  },
  Good: {
    score: "text-teal-200",
    label: "text-teal-300",
  },
  Caution: {
    score: "text-yellow-200",
    label: "text-yellow-300",
  },
  Risky: {
    score: "text-orange-200",
    label: "text-orange-300",
  },
  Dangerous: {
    score: "text-red-200",
    label: "text-red-300",
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
  const [purchaseType, setPurchaseType] = useState<PurchaseType>("One-Time");
  const [spendingDecisionResult, setSpendingDecisionResult] =
    useState<SpendingDecisionResult | null>(null);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const [goalFormName, setGoalFormName] = useState("");
  const [goalFormTarget, setGoalFormTarget] = useState("");
  const [goalFormSaved, setGoalFormSaved] = useState("");
  const [goalFormIsPrimary, setGoalFormIsPrimary] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [monthlyContribution, setMonthlyContribution] = useState("");
  const [savingsGoalCalculated, setSavingsGoalCalculated] = useState(false);
  const [plannedBills, setPlannedBills] = useState<PlannedBill[]>([]);
  const [billName, setBillName] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [billDueDate, setBillDueDate] = useState("");
  const [billFormType, setBillFormType] = useState<BillFormType>("one-time");
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
  const [recurringFirstDueDate, setRecurringFirstDueDate] = useState("");
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
  const [editingTimelineEventId, setEditingTimelineEventId] = useState<
    string | null
  >(null);
  const [editTimelineName, setEditTimelineName] = useState("");
  const [editTimelineAmount, setEditTimelineAmount] = useState("");
  const [editTimelineDate, setEditTimelineDate] = useState("");
  const [editTimelineType, setEditTimelineType] =
    useState<TimelineEventType>("Expense");

  const toggleSection = (key: SectionKey) => {
    setSectionOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const profileDisplayName = profile.name.trim() || "Account";

  const getPersistedSnapshot = (): PersistedAppData => {
    const primaryGoal = getPrimarySavingsGoal(savingsGoals);

    return {
    purchaseName,
    purchaseAmount,
    purchaseDate,
    purchaseType,
    spendingDecisionResult,
    savingsGoals,
    goalName: primaryGoal?.name ?? "",
    goalAmount: primaryGoal ? String(primaryGoal.targetAmount) : "",
    currentSaved: primaryGoal ? String(primaryGoal.currentSaved) : "",
    monthlyContribution,
    savingsGoalCalculated,
    plannedBills,
    billName,
    billAmount,
    billDueDate,
    billFormType,
    monthlyIncome,
    monthlyExpenses,
    monthlyBufferCalculated,
    emergencyMonthlyExpenses: monthlyExpenses,
    emergencyCurrentSavings,
    emergencyFundCalculated: monthlyBufferCalculated,
    coachCurrentSavings: primaryGoal ? String(primaryGoal.currentSaved) : "",
    coachSavingsGoal: primaryGoal ? String(primaryGoal.targetAmount) : "",
    coachMonthlySavings: monthlyContribution,
    coachAdviceShown: savingsGoalCalculated,
    timelineEvents,
    eventName,
    eventAmount,
    eventDate,
    eventType,
    recurringBills,
    recurringBillName: billName,
    recurringBillAmount: billAmount,
    recurringDueDay,
    recurringFirstDueDate,
    recurringFrequency,
    plannedPaychecks,
    paycheckName,
    paycheckAmount,
    paycheckDate,
    checkingBalance,
    profile,
  };
  };

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
      setBillFormType(legacySaved.billFormType ?? "one-time");
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
      setSavingsGoals(migrateSavingsGoals(legacySaved));
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
      setRecurringFirstDueDate(legacySaved.recurringFirstDueDate ?? "");
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
    savingsGoals,
    monthlyContribution,
    savingsGoalCalculated,
    plannedBills,
    billName,
    billAmount,
    billDueDate,
    billFormType,
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
  recurringFirstDueDate,
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

  const calculateMonthlyBuffer = () => {
    setMonthlyBufferCalculated(true);
  };

  const cancelEditGoal = () => {
    setEditingGoalId(null);
    setGoalFormName("");
    setGoalFormTarget("");
    setGoalFormSaved("");
    setGoalFormIsPrimary(false);
  };

  const startEditGoal = (goal: SavingsGoal) => {
    setEditingGoalId(goal.id);
    setGoalFormName(goal.name);
    setGoalFormTarget(String(goal.targetAmount));
    setGoalFormSaved(String(goal.currentSaved));
    setGoalFormIsPrimary(goal.isPrimary);
  };

  const saveGoal = () => {
    const name = toTitleCase(goalFormName.trim());
    const targetAmount = Number(goalFormTarget);
    const currentSaved = Number(goalFormSaved);

    if (
      !name ||
      Number.isNaN(targetAmount) ||
      targetAmount <= 0 ||
      Number.isNaN(currentSaved) ||
      currentSaved < 0
    ) {
      return;
    }

    if (editingGoalId) {
      setSavingsGoals((prev) =>
        prev.map((goal) => {
          if (goal.id !== editingGoalId) {
            return goalFormIsPrimary
              ? { ...goal, isPrimary: false }
              : goal;
          }

          return {
            ...goal,
            name,
            targetAmount,
            currentSaved,
            isPrimary: goalFormIsPrimary,
          };
        }),
      );
    } else {
      const shouldBePrimary =
        goalFormIsPrimary || !savingsGoals.some((goal) => goal.isPrimary);

      setSavingsGoals((prev) => [
        ...prev.map((goal) =>
          shouldBePrimary ? { ...goal, isPrimary: false } : goal,
        ),
        {
          id: crypto.randomUUID(),
          name,
          targetAmount,
          currentSaved,
          isPrimary: shouldBePrimary,
        },
      ]);
    }

    cancelEditGoal();
  };

  const deleteGoal = (goalId: string) => {
    setSavingsGoals((prev) => prev.filter((goal) => goal.id !== goalId));
    if (editingGoalId === goalId) {
      cancelEditGoal();
    }
  };

  const setPrimaryGoal = (goalId: string) => {
    setSavingsGoals((prev) =>
      prev.map((goal) => ({
        ...goal,
        isPrimary: goal.id === goalId,
      })),
    );
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
    setPurchaseType("One-Time");
    setSpendingDecisionResult(null);
    setSavingsGoals([]);
    cancelEditGoal();
    setMonthlyContribution("");
    setSavingsGoalCalculated(false);
    setPlannedBills([]);
    setBillName("");
    setBillAmount("");
    setBillDueDate("");
    setBillFormType("one-time");
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
    setRecurringFirstDueDate("");
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

  const resetBillFormFields = () => {
    setBillName("");
    setBillAmount("");
    setBillDueDate("");
    setRecurringDueDay("1");
    setRecurringFirstDueDate("");
    setRecurringFrequency("Monthly");
    setEditingBillId(null);
    setEditingRecurringBillId(null);
  };

  const handleBillFormTypeChange = (type: BillFormType) => {
    setBillFormType(type);
    setEditingBillId(null);
    setEditingRecurringBillId(null);
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
    } else {
      setPlannedBills((prev) => [
        ...prev,
        { id: crypto.randomUUID(), name, amount, dueDate },
      ]);
    }

    resetBillFormFields();
  };

  const saveRecurringBill = () => {
    const name = billName.trim();
    const amount = Number(billAmount);
    const firstDueDate = recurringFirstDueDate.trim();

    if (!name || Number.isNaN(amount) || amount <= 0) return;

    let dueDay: number;
    let billFirstDueDate: string | undefined;

    if (recurringFrequency === "Monthly") {
      dueDay = Number(recurringDueDay);
      if (Number.isNaN(dueDay) || dueDay < 1 || dueDay > 31) return;
    } else if (recurringFrequency === "Weekly") {
      dueDay = Number(recurringDueDay);
      if (Number.isNaN(dueDay) || dueDay < 0 || dueDay > 6) return;
    } else {
      if (!firstDueDate) return;
      const [year, month, day] = firstDueDate.split("-").map(Number);
      const anchor = new Date(year, month - 1, day);
      if (Number.isNaN(anchor.getTime())) return;
      dueDay = anchor.getDay();
      billFirstDueDate = firstDueDate;
    }

    const recurringPayload = {
      name,
      amount,
      dueDay,
      frequency: recurringFrequency,
      ...(billFirstDueDate ? { firstDueDate: billFirstDueDate } : {}),
    };

    if (editingRecurringBillId) {
      setRecurringBills((prev) =>
        prev.map((bill) => {
          if (bill.id !== editingRecurringBillId) return bill;

          const updated: RecurringBill = {
            ...bill,
            name,
            amount,
            dueDay,
            frequency: recurringFrequency,
          };

          if (billFirstDueDate) {
            updated.firstDueDate = billFirstDueDate;
          } else {
            delete updated.firstDueDate;
          }

          return updated;
        }),
      );
    } else {
      setRecurringBills((prev) => [
        ...prev,
        { id: crypto.randomUUID(), ...recurringPayload },
      ]);
    }

    resetBillFormFields();
  };

  const saveBill = () => {
    if (billFormType === "one-time") {
      saveOneTimeBill();
    } else {
      saveRecurringBill();
    }
  };

  const startEditBill = (bill: PlannedBill) => {
    setBillFormType("one-time");
    setEditingRecurringBillId(null);
    setEditingBillId(bill.id);
    setBillName(bill.name);
    setBillAmount(String(bill.amount));
    setBillDueDate(bill.dueDate);
  };

  const removeBill = (id: string) => {
    setPlannedBills((prev) => prev.filter((bill) => bill.id !== id));
    if (editingBillId === id) {
      resetBillFormFields();
    }
  };

  const startEditRecurringBill = (bill: RecurringBill) => {
    setBillFormType("recurring");
    setEditingBillId(null);
    setEditingRecurringBillId(bill.id);
    setBillName(bill.name);
    setBillAmount(String(bill.amount));
    setRecurringFrequency(bill.frequency);
    setRecurringDueDay(String(bill.dueDay));
    setRecurringFirstDueDate(
      bill.firstDueDate ??
        (bill.frequency === "Biweekly"
          ? getNextWeekdayISO(bill.dueDay)
          : ""),
    );
  };

  const removeRecurringBill = (id: string) => {
    setRecurringBills((prev) => prev.filter((bill) => bill.id !== id));
    if (editingRecurringBillId === id) {
      resetBillFormFields();
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
        getPrimarySavingsGoal(savingsGoals),
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

  const cancelEditTimelineEvent = () => {
    setEditingTimelineEventId(null);
    setEditTimelineName("");
    setEditTimelineAmount("");
    setEditTimelineDate("");
    setEditTimelineType("Expense");
  };

  const startEditTimelineEvent = (event: TimelineEvent) => {
    setEditingTimelineEventId(event.id);
    setEditTimelineName(event.name);
    setEditTimelineAmount(String(event.amount));
    setEditTimelineDate(event.date);
    setEditTimelineType(event.type);
  };

  const deleteTimelineEvent = (event: TimelineEvent) => {
    const source = parseTimelineEventSource(event.id);
    if (!source) return;

    switch (source.kind) {
      case "bill":
        removeBill(source.billId);
        break;
      case "paycheck":
        removePaycheck(source.paycheckId);
        break;
      case "recurring":
        setRecurringBills((prev) =>
          prev.map((bill) =>
            bill.id === source.billId
              ? {
                  ...bill,
                  skippedDates: Array.from(
                    new Set([
                      ...(bill.skippedDates ?? []),
                      source.occurrenceDate,
                    ]),
                  ),
                }
              : bill,
          ),
        );
        break;
      case "planned-purchase":
      case "manual":
        setTimelineEvents((prev) =>
          prev.filter((timelineEvent) => timelineEvent.id !== event.id),
        );
        break;
    }

    if (editingTimelineEventId === event.id) {
      cancelEditTimelineEvent();
    }
  };

  const saveEditTimelineEvent = () => {
    if (!editingTimelineEventId) return;

    const name = editTimelineName.trim();
    const amount = Number(editTimelineAmount);
    const date = editTimelineDate.trim();
    const type = editTimelineType;

    if (!name || !date || Number.isNaN(amount) || amount <= 0) return;

    const source = parseTimelineEventSource(editingTimelineEventId);
    if (!source) return;

    switch (source.kind) {
      case "bill":
        if (type === "Expense") {
          setPlannedBills((prev) =>
            prev.map((bill) =>
              bill.id === source.billId
                ? { ...bill, name, amount, dueDate: date }
                : bill,
            ),
          );
        } else {
          removeBill(source.billId);
          setTimelineEvents((prev) => [
            ...prev,
            { id: crypto.randomUUID(), name, amount, date, type },
          ]);
        }
        break;
      case "paycheck":
        if (type === "Income") {
          setPlannedPaychecks((prev) =>
            prev.map((paycheck) =>
              paycheck.id === source.paycheckId
                ? { ...paycheck, name, amount, payDate: date }
                : paycheck,
            ),
          );
        } else {
          removePaycheck(source.paycheckId);
          setTimelineEvents((prev) => [
            ...prev,
            { id: crypto.randomUUID(), name, amount, date, type },
          ]);
        }
        break;
      case "recurring": {
        const originalDate = source.occurrenceDate;
        if (type === "Expense" && date === originalDate) {
          setRecurringBills((prev) =>
            prev.map((bill) =>
              bill.id === source.billId ? { ...bill, name, amount } : bill,
            ),
          );
        } else if (type === "Expense") {
          setRecurringBills((prev) =>
            prev.map((bill) =>
              bill.id === source.billId
                ? {
                    ...bill,
                    skippedDates: Array.from(
                      new Set([...(bill.skippedDates ?? []), originalDate]),
                    ),
                  }
                : bill,
            ),
          );
          setPlannedBills((prev) => [
            ...prev,
            { id: crypto.randomUUID(), name, amount, dueDate: date },
          ]);
        } else {
          setRecurringBills((prev) =>
            prev.map((bill) =>
              bill.id === source.billId
                ? {
                    ...bill,
                    skippedDates: Array.from(
                      new Set([...(bill.skippedDates ?? []), originalDate]),
                    ),
                  }
                : bill,
            ),
          );
          setTimelineEvents((prev) => [
            ...prev,
            { id: crypto.randomUUID(), name, amount, date, type },
          ]);
        }
        break;
      }
      case "planned-purchase":
      case "manual":
        setTimelineEvents((prev) =>
          prev.map((event) =>
            event.id === source.eventId
              ? { ...event, name, amount, date, type }
              : event,
          ),
        );
        break;
    }

    cancelEditTimelineEvent();
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
  const primarySavingsGoal = getPrimarySavingsGoal(savingsGoals);
  const spendingGoalAfterPurchaseStatus = spendingDecisionResult
    ? getSpendingGoalAfterPurchaseStatus(
        spendingDecisionResult.verdict,
        spendingDecisionResult.currentSafeToSpend,
        spendingDecisionResult.safeToSpendAfterPurchase,
      )
    : null;
  const nextUpcomingPaycheck = getNextUpcomingPaycheck(plannedPaychecks);
  const nextPaycheckDateLabel = nextUpcomingPaycheck
    ? formatDueDate(nextUpcomingPaycheck.payDate)
    : "Not scheduled";
  const nextPaycheckRelativeLabel = nextUpcomingPaycheck
    ? getRelativePaydayLabel(nextUpcomingPaycheck.payDate)
    : null;
  const dashboardCashFlow = getDashboardCashFlowMessage(
    cashShortfallDetected,
    financialCalculation?.rows,
    todayISO,
    financialCalculation?.shortfallCause ?? null,
  );
  const dashboardCashFlowLabel = dashboardCashFlow.status;

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
                    <dd className="mt-2 text-xl font-bold text-white sm:text-2xl">
                      {nextPaycheckDateLabel}
                    </dd>
                    {nextPaycheckRelativeLabel ? (
                      <dd className="mt-1 text-xs text-slate-500 sm:text-sm">
                        {nextPaycheckRelativeLabel}
                      </dd>
                    ) : (
                      <dd className="mt-1 text-xs text-slate-500 sm:text-sm">
                        Your next payday
                      </dd>
                    )}
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
                      Savings Goal
                    </dt>
                    {primarySavingsGoal ? (
                      <>
                        <dd className="mt-2 text-lg font-bold leading-snug text-white sm:text-xl">
                          {formatGoalName(primarySavingsGoal.name)}
                        </dd>
                        {isGoalComplete(primarySavingsGoal) ? (
                          <dd className="mt-2 text-xl font-bold text-violet-200 sm:text-2xl">
                            Goal Complete 🎉
                          </dd>
                        ) : (
                          <>
                            <dd className="mt-2 text-xl font-bold tabular-nums text-violet-200 sm:text-2xl">
                              {getGoalProgressPercent(primarySavingsGoal)}% Complete
                            </dd>
                            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                              <div
                                className="h-full rounded-full bg-violet-400 transition-all"
                                style={{
                                  width: `${getGoalProgressPercent(primarySavingsGoal)}%`,
                                }}
                              />
                            </div>
                          </>
                        )}
                        <dd className="mt-2 text-xs tabular-nums text-slate-500 sm:text-sm">
                          ${primarySavingsGoal.currentSaved.toLocaleString()} / $
                          {primarySavingsGoal.targetAmount.toLocaleString()}
                        </dd>
                      </>
                    ) : (
                      <>
                        <dd className="mt-2 text-xl font-bold text-white sm:text-2xl">
                          No Goal Set
                        </dd>
                        <dd className="mt-1 text-xs text-slate-500 sm:text-sm">
                          Create a savings goal
                        </dd>
                      </>
                    )}
                  </div>
                </dl>
                <div
                  role="status"
                  className={`mt-5 rounded-xl border px-4 py-4 sm:px-5 sm:py-5 ${
                    cashShortfallDetected
                      ? "border-red-500/30 bg-red-500/10"
                      : "border-emerald-500/20 bg-emerald-500/10"
                  }`}
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400 sm:text-sm">
                    Financial Confidence says:
                  </p>
                  <p
                    className={`mt-2 text-xl font-bold sm:text-2xl ${
                      dashboardStatusStyles[dashboardCashFlowLabel].badgeText
                    }`}
                  >
                    {dashboardCashFlow.headline}
                  </p>
                  <p
                    className={`mt-2 text-sm sm:text-base ${
                      cashShortfallDetected
                        ? "text-red-200"
                        : "text-emerald-200"
                    }`}
                  >
                    {dashboardCashFlow.detail}
                  </p>
                </div>
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
                  <form
                    className="space-y-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveBill();
                    }}
                  >
                    <fieldset>
                      <legend className="mb-2 block text-sm font-medium text-slate-300">
                        Bill Type
                      </legend>
                      <div className="flex flex-wrap gap-4">
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                          <input
                            type="radio"
                            name="bill-type"
                            checked={billFormType === "one-time"}
                            onChange={() => handleBillFormTypeChange("one-time")}
                            className="h-4 w-4 border-white/20 bg-white/5 text-amber-500 focus:ring-amber-500/30"
                          />
                          One-Time
                        </label>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                          <input
                            type="radio"
                            name="bill-type"
                            checked={billFormType === "recurring"}
                            onChange={() => handleBillFormTypeChange("recurring")}
                            className="h-4 w-4 border-white/20 bg-white/5 text-amber-500 focus:ring-amber-500/30"
                          />
                          Recurring
                        </label>
                      </div>
                    </fieldset>

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

                    {billFormType === "one-time" ? (
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
                          className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white transition focus:border-amber-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-amber-500/20 [color-scheme:dark]"
                        />
                      </div>
                    ) : (
                      <>
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
                              if (frequency === "Monthly") {
                                setRecurringDueDay("1");
                              } else if (frequency === "Weekly") {
                                setRecurringDueDay("1");
                                setRecurringFirstDueDate("");
                              } else {
                                setRecurringFirstDueDate("");
                              }
                            }}
                            className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white transition focus:border-amber-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                          >
                            <option value="Monthly">Monthly</option>
                            <option value="Weekly">Weekly</option>
                            <option value="Biweekly">Biweekly</option>
                          </select>
                        </div>

                        {recurringFrequency === "Monthly" ? (
                          <div>
                            <label
                              htmlFor="recurring-due-day"
                              className="mb-2 block text-sm font-medium text-slate-300"
                            >
                              Due Day
                            </label>
                            <input
                              id="recurring-due-day"
                              type="number"
                              min="1"
                              max="31"
                              step="1"
                              placeholder="1"
                              value={recurringDueDay}
                              onChange={(e) => setRecurringDueDay(e.target.value)}
                              className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder:text-slate-600 transition focus:border-amber-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                            />
                          </div>
                        ) : null}

                        {recurringFrequency === "Weekly" ? (
                          <div>
                            <label
                              htmlFor="recurring-weekday"
                              className="mb-2 block text-sm font-medium text-slate-300"
                            >
                              Day of Week
                            </label>
                            <select
                              id="recurring-weekday"
                              value={recurringDueDay}
                              onChange={(e) => setRecurringDueDay(e.target.value)}
                              className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white transition focus:border-amber-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                            >
                              {WEEKDAYS.map((day, index) => (
                                <option key={day} value={index}>
                                  {day}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}

                        {recurringFrequency === "Biweekly" ? (
                          <div>
                            <label
                              htmlFor="recurring-first-due-date"
                              className="mb-2 block text-sm font-medium text-slate-300"
                            >
                              First Due Date
                            </label>
                            <input
                              id="recurring-first-due-date"
                              type="date"
                              value={recurringFirstDueDate}
                              onChange={(e) =>
                                setRecurringFirstDueDate(e.target.value)
                              }
                              className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white transition focus:border-amber-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-amber-500/20 [color-scheme:dark]"
                            />
                          </div>
                        ) : null}
                      </>
                    )}

                    <button
                      type="submit"
                      className="w-full rounded-xl border border-amber-500/40 bg-amber-600/20 py-3.5 text-sm font-semibold text-amber-300 transition hover:border-amber-500/60 hover:bg-amber-600/30 focus:outline-none focus:ring-2 focus:ring-amber-500/20 active:bg-amber-600/40"
                    >
                      {editingBillId || editingRecurringBillId
                        ? "Save Bill"
                        : "Add Bill"}
                    </button>
                  </form>

                  <div className="border-t border-white/10 pt-6">
                    <h4 className="mb-3 text-sm font-semibold text-amber-300">
                      Upcoming Bills
                    </h4>
                    {plannedBills.length > 0 ? (
                      <div className="space-y-4">
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
                    ) : (
                      <p className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-400">
                        No one-time bills yet.
                      </p>
                    )}
                  </div>

                  <div className="border-t border-white/10 pt-6">
                    <h4 className="mb-3 text-sm font-semibold text-rose-300">
                      Active Recurring Bills
                    </h4>
                    {recurringBills.length > 0 ? (
                      <div className="space-y-4">
                        <ul className="space-y-2">
                          {recurringBills.map((bill) => (
                            <li
                              key={bill.id}
                              className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
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
                    ) : (
                      <p className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-400">
                        No recurring bills yet.
                      </p>
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
                              className={`rounded-lg border px-4 py-3 text-sm ${
                                event.type === "Income"
                                  ? "border-emerald-500/20 bg-emerald-500/5"
                                  : "border-red-500/20 bg-red-500/5"
                              }`}
                            >
                              {editingTimelineEventId === event.id ? (
                                <div className="space-y-3">
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="sm:col-span-2">
                                      <label className="mb-1 block text-xs font-medium text-slate-400">
                                        Event Name
                                      </label>
                                      <input
                                        type="text"
                                        value={editTimelineName}
                                        onChange={(e) =>
                                          setEditTimelineName(e.target.value)
                                        }
                                        className="block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-teal-500/50 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                                      />
                                    </div>
                                    <div>
                                      <label className="mb-1 block text-xs font-medium text-slate-400">
                                        Amount
                                      </label>
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={editTimelineAmount}
                                        onChange={(e) =>
                                          setEditTimelineAmount(e.target.value)
                                        }
                                        className="block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-teal-500/50 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                                      />
                                    </div>
                                    <div>
                                      <label className="mb-1 block text-xs font-medium text-slate-400">
                                        Date
                                      </label>
                                      <input
                                        type="date"
                                        value={editTimelineDate}
                                        onChange={(e) =>
                                          setEditTimelineDate(e.target.value)
                                        }
                                        className="block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-teal-500/50 focus:outline-none focus:ring-2 focus:ring-teal-500/20 [color-scheme:dark]"
                                      />
                                    </div>
                                    <div className="sm:col-span-2">
                                      <label className="mb-1 block text-xs font-medium text-slate-400">
                                        Event Type
                                      </label>
                                      <select
                                        value={editTimelineType}
                                        onChange={(e) =>
                                          setEditTimelineType(
                                            e.target.value as TimelineEventType,
                                          )
                                        }
                                        className="block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-teal-500/50 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                                      >
                                        <option value="Income">Income</option>
                                        <option value="Expense">Expense</option>
                                      </select>
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={saveEditTimelineEvent}
                                      className="rounded-lg border border-teal-500/40 bg-teal-600/20 px-3 py-1.5 text-xs font-semibold text-teal-300 transition hover:bg-teal-600/30"
                                    >
                                      Save
                                    </button>
                                    <button
                                      type="button"
                                      onClick={cancelEditTimelineEvent}
                                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/[0.07]"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[5rem_1fr_auto_auto_auto_auto] sm:items-center sm:gap-3">
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
                                    {event.type === "Income" ? "+" : "-"}$
                                    {event.amount}
                                  </span>
                                  <span className="font-semibold tabular-nums text-teal-200">
                                    ${runningBalance}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => startEditTimelineEvent(event)}
                                    aria-label={`Edit ${event.name}`}
                                    className="justify-self-start rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-teal-500/40 hover:bg-teal-500/10 hover:text-teal-200 sm:justify-self-end"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteTimelineEvent(event)}
                                    aria-label={`Delete ${event.name}`}
                                    className="justify-self-start rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-200 sm:justify-self-end"
                                  >
                                    Delete
                                  </button>
                                </div>
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
                subtitle="Track and manage your savings goals"
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
                <div className="space-y-6">
                  <div>
                    <h4 className="mb-3 text-sm font-semibold text-violet-300">
                      Savings Goals
                    </h4>
                    <form
                      className="space-y-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveGoal();
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
                          placeholder="Example: Wedding Fund"
                          value={goalFormName}
                          onChange={(e) => setGoalFormName(e.target.value)}
                          className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder:text-slate-600 transition focus:border-violet-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="goal-target"
                          className="mb-2 block text-sm font-medium text-slate-300"
                        >
                          Target Amount
                        </label>
                        <div className="relative">
                          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-500">
                            $
                          </span>
                          <input
                            id="goal-target"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            value={goalFormTarget}
                            onChange={(e) => setGoalFormTarget(e.target.value)}
                            className="block w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-9 pr-4 text-white placeholder:text-slate-600 transition focus:border-violet-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                          />
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="goal-saved"
                          className="mb-2 block text-sm font-medium text-slate-300"
                        >
                          Current Saved
                        </label>
                        <div className="relative">
                          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-500">
                            $
                          </span>
                          <input
                            id="goal-saved"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            value={goalFormSaved}
                            onChange={(e) => setGoalFormSaved(e.target.value)}
                            className="block w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-9 pr-4 text-white placeholder:text-slate-600 transition focus:border-violet-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                          />
                        </div>
                      </div>

                      <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                        <input
                          type="checkbox"
                          checked={goalFormIsPrimary}
                          onChange={(e) => setGoalFormIsPrimary(e.target.checked)}
                          className="h-4 w-4 rounded border-white/20 bg-white/5 text-violet-500 focus:ring-violet-500/30"
                        />
                        Set as Primary Goal
                      </label>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <button
                          type="submit"
                          className="w-full rounded-xl border border-violet-500/40 bg-violet-600/20 py-3.5 text-sm font-semibold text-violet-300 transition hover:border-violet-500/60 hover:bg-violet-600/30 focus:outline-none focus:ring-2 focus:ring-violet-500/20 active:bg-violet-600/40"
                        >
                          {editingGoalId ? "Save Goal" : "Add Goal"}
                        </button>
                        {editingGoalId ? (
                          <button
                            type="button"
                            onClick={cancelEditGoal}
                            className="w-full rounded-xl border border-white/10 bg-white/5 py-3.5 text-sm font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-white/10 active:bg-white/10"
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </form>
                  </div>

                  {savingsGoals.length > 0 ? (
                    <ul className="space-y-3">
                      {savingsGoals.map((goal) => (
                        <li
                          key={goal.id}
                          className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-4"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-semibold text-white">
                                  {formatGoalName(goal.name)}
                                </p>
                                {goal.isPrimary ? (
                                  <span className="inline-flex rounded-full bg-violet-500/20 px-2.5 py-0.5 text-xs font-semibold text-violet-300">
                                    Primary
                                  </span>
                                ) : null}
                              </div>
                              {isGoalComplete(goal) ? (
                                <p className="mt-2 text-2xl font-bold text-violet-200">
                                  Goal Complete 🎉
                                </p>
                              ) : (
                                <>
                                  <p className="mt-2 text-2xl font-bold tabular-nums text-violet-200">
                                    {getGoalProgressPercent(goal)}% Complete
                                  </p>
                                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                                    <div
                                      className="h-full rounded-full bg-violet-400 transition-all"
                                      style={{
                                        width: `${getGoalProgressPercent(goal)}%`,
                                      }}
                                    />
                                  </div>
                                </>
                              )}
                              <p className="mt-2 text-sm tabular-nums text-slate-400">
                                ${goal.currentSaved.toLocaleString()} / $
                                {goal.targetAmount.toLocaleString()}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {!goal.isPrimary ? (
                                <button
                                  type="button"
                                  onClick={() => setPrimaryGoal(goal.id)}
                                  className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-300 transition hover:bg-violet-500/20"
                                >
                                  Set Primary
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => startEditGoal(goal)}
                                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-teal-500/40 hover:text-teal-200"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteGoal(goal.id)}
                                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-red-500/40 hover:text-red-300"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-slate-400">
                      No savings goals yet. Add your first goal above.
                    </p>
                  )}

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
                      <option value="One-Time">One-Time</option>
                      <option value="Daily">Daily</option>
                      <option value="Weekly">Weekly</option>
                      <option value="Monthly">Monthly</option>
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
                    {(purchaseType === "Daily" ||
                      purchaseType === "Weekly" ||
                      purchaseType === "Monthly") &&
                    purchaseAmount !== "" ? (
                      <p className="mt-2 text-xs text-slate-500">
                        {getPurchaseImpactSummary(
                          Number(purchaseAmount) || 0,
                          purchaseType,
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
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400 sm:text-sm">
                      Financial Confidence says:
                    </p>
                    <p
                      className={`mt-2 text-xl font-bold leading-snug sm:text-2xl ${
                        spendingVerdictStyles[spendingDecisionResult.verdict].title
                      }`}
                    >
                      {spendingDecisionResult.mainAnswer}
                    </p>

                    <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Financial Confidence Score
                      </p>
                      <p
                        className={`mt-1 text-2xl font-bold tabular-nums ${
                          confidenceScoreStyles[
                            spendingDecisionResult.confidenceScoreLabel
                          ].score
                        }`}
                      >
                        {spendingDecisionResult.confidenceScore}/100
                      </p>
                      <p
                        className={`mt-0.5 text-sm font-semibold ${
                          confidenceScoreStyles[
                            spendingDecisionResult.confidenceScoreLabel
                          ].label
                        }`}
                      >
                        {spendingDecisionResult.confidenceScoreLabel}
                      </p>
                    </div>

                    <div className="mt-4 space-y-4 border-t border-white/10 pt-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Why
                        </p>
                        <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
                          {spendingDecisionResult.why}
                        </p>
                      </div>

                      {spendingDecisionResult.purchaseType === "One-Time" ? (
                        <div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Purchase Impact
                          </p>
                          <dl className="mt-2 space-y-2 text-sm">
                            <div className="flex items-center justify-between gap-4">
                              <dt className="text-slate-400">One-time cost</dt>
                              <dd className="font-semibold tabular-nums text-white">
                                ${spendingDecisionResult.cost.toLocaleString()}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      ) : spendingDecisionResult.purchaseType === "Monthly" ? (
                        <div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Purchase Impact
                          </p>
                          <dl className="mt-2 space-y-2 text-sm">
                            <div className="flex items-center justify-between gap-4">
                              <dt className="text-slate-400">Monthly amount</dt>
                              <dd className="font-semibold tabular-nums text-white">
                                ${spendingDecisionResult.cost.toLocaleString()}/month
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <dt className="text-slate-400">
                                Estimated annual impact
                              </dt>
                              <dd className="font-semibold tabular-nums text-white">
                                ${spendingDecisionResult.annualImpact.toLocaleString()}
                              </dd>
                            </div>
                          </dl>
                          {spendingDecisionResult.impactSummary ? (
                            <p className="mt-3 text-xs leading-relaxed text-slate-400">
                              {spendingDecisionResult.impactSummary}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Purchase Impact
                          </p>
                          <dl className="mt-2 space-y-2 text-sm">
                            <div className="flex items-center justify-between gap-4">
                              <dt className="text-slate-400">
                                {spendingDecisionResult.purchaseType === "Daily"
                                  ? "Daily amount"
                                  : "Weekly amount"}
                              </dt>
                              <dd className="font-semibold tabular-nums text-white">
                                ${spendingDecisionResult.cost.toLocaleString()}
                                {spendingDecisionResult.purchaseType === "Daily"
                                  ? "/day"
                                  : "/week"}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <dt className="text-slate-400">
                                Estimated monthly impact
                              </dt>
                              <dd className="font-semibold tabular-nums text-white">
                                ${spendingDecisionResult.monthlyImpact.toLocaleString()}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <dt className="text-slate-400">
                                Estimated annual impact
                              </dt>
                              <dd className="font-semibold tabular-nums text-white">
                                ${spendingDecisionResult.annualImpact.toLocaleString()}
                              </dd>
                            </div>
                          </dl>
                          {spendingDecisionResult.impactSummary ? (
                            <p className="mt-3 text-xs leading-relaxed text-slate-400">
                              {spendingDecisionResult.impactSummary}
                            </p>
                          ) : null}
                        </div>
                      )}

                      <div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Safe To Spend
                        </p>
                        <dl className="mt-2 space-y-2 text-sm">
                          <div className="flex items-center justify-between gap-4">
                            <dt className="text-slate-400">
                              Safe To Spend Before Purchase
                            </dt>
                            <dd className="font-semibold tabular-nums text-white">
                              $
                              {spendingDecisionResult.currentSafeToSpend.toLocaleString()}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <dt className="text-slate-400">Purchase Impact</dt>
                            <dd className="font-semibold tabular-nums text-red-300">
                              -$
                              {spendingDecisionResult.purchaseCost.toLocaleString()}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-2">
                            <dt className="font-medium text-slate-300">
                              Safe To Spend After Purchase
                            </dt>
                            <dd className="text-base font-bold tabular-nums text-white">
                              $
                              {spendingDecisionResult.safeToSpendAfterPurchase.toLocaleString()}
                            </dd>
                          </div>
                        </dl>
                      </div>

                      <div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Goal Impact
                        </p>
                        {primarySavingsGoal ? (
                          <div className="mt-2 space-y-2">
                            <p className="font-semibold text-white">
                              {formatGoalName(primarySavingsGoal.name)}
                            </p>
                            {isGoalComplete(primarySavingsGoal) ? (
                              <p className="text-sm text-violet-200">
                                Goal Complete 🎉
                              </p>
                            ) : (
                              <p className="text-sm tabular-nums text-violet-200">
                                {getGoalProgressPercent(primarySavingsGoal)}% Complete
                              </p>
                            )}
                            <div className="border-t border-white/10 pt-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                After Purchase:
                              </p>
                              <p
                                className={`mt-1 text-sm font-medium ${
                                  spendingGoalAfterPurchaseStatus ===
                                  "Still On Track"
                                    ? "text-emerald-300"
                                    : "text-yellow-300"
                                }`}
                              >
                                {spendingGoalAfterPurchaseStatus}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-slate-400">
                            No primary savings goal set.
                          </p>
                        )}
                      </div>

                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Recommendation
                        </p>
                        <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-200">
                          {spendingDecisionResult.recommendation}
                        </p>
                      </div>
                    </div>

                    {spendingDecisionResult.usedTodayForAnalysisOnly ? (
                      <p className="mt-4 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-sm text-yellow-200/90">
                        No purchase date selected. Using today for analysis only.
                      </p>
                    ) : null}

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
