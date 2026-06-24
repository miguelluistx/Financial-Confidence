"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  formatAccountCreatedDate,
  getLanguageLabel,
  getUserDisplayName,
  getUserLanguagePreference,
} from "@/lib/auth/user";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

type PlannedBill = {
  id: string;
  name: string;
  amount: number;
  dueDate: string;
};

type BillFormType = "one-time" | "recurring";

type PaycheckFormType = "manual" | "recurring";

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
  | { kind: "recurring-paycheck"; paycheckId: string; occurrenceDate: string }
  | { kind: "recurring"; billId: string; occurrenceDate: string }
  | { kind: "manual"; eventId: string }
  | { kind: "planned-purchase"; eventId: string };

type ConfidenceScoreLabel =
  | "Excellent"
  | "Good"
  | "Caution"
  | "Risky"
  | "Dangerous";

type CushionMeterLabel = "Excellent" | "Good" | "Caution" | "Low" | "Danger";

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
  confidenceScoreBefore: number;
  confidenceScoreImpact: number;
  currentRemainingCash: number;
  remainingCashAfterPurchase: number;
  monthlyImpactAmount: number;
  annualImpactAmount: number;
  lowestBalanceBeforePurchase: number;
  lowestBalanceAfterPurchase: number;
  cushionLabel: CushionMeterLabel;
  cushionProgressPercent: number;
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

const APP_VERSION = "1.0.0";

const TOUCH_TARGET_BUTTON_CLASS =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border px-3 py-2 text-xs";

function confirmAction(message: string): boolean {
  return window.confirm(message);
}

function getTimelineDeleteConfirmMessage(
  event: TimelineEvent,
  source: TimelineEventSource,
): string {
  switch (source.kind) {
    case "bill":
      return `Delete "${event.name}" from your bills and timeline?`;
    case "paycheck":
      return `Delete "${event.name}" from your paychecks and timeline?`;
    case "recurring":
      return `Skip "${event.name}" on ${formatDueDate(source.occurrenceDate)}? Future bill dates will continue.`;
    case "recurring-paycheck":
      return `Skip "${event.name}" on ${formatDueDate(source.occurrenceDate)}? Future paychecks will continue.`;
    case "planned-purchase":
      return `Remove planned purchase "${event.name}" from your timeline?`;
    case "manual":
      return `Delete "${event.name}" from your timeline?`;
  }
}

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

function getLowestBalanceRiskStyles(amount: number): {
  value: string;
  border: string;
  bg: string;
} {
  if (amount > 1000) {
    return {
      value: "text-emerald-300",
      border: "border-emerald-500/20",
      bg: "bg-emerald-500/10",
    };
  }

  if (amount >= 500) {
    return {
      value: "text-yellow-300",
      border: "border-yellow-500/20",
      bg: "bg-yellow-500/10",
    };
  }

  if (amount >= 0) {
    return {
      value: "text-orange-300",
      border: "border-orange-500/20",
      bg: "bg-orange-500/10",
    };
  }

  return {
    value: "text-red-300",
    border: "border-red-500/20",
    bg: "bg-red-500/10",
  };
}

function getCushionMeter(remainingCash: number): {
  label: CushionMeterLabel;
  progressPercent: number;
  bar: string;
  text: string;
  border: string;
  bg: string;
} {
  let label: CushionMeterLabel;

  if (remainingCash > 2000) label = "Excellent";
  else if (remainingCash >= 1000) label = "Good";
  else if (remainingCash >= 500) label = "Caution";
  else if (remainingCash >= 0) label = "Low";
  else label = "Danger";

  const progressPercent =
    remainingCash <= 0
      ? 0
      : Math.min(100, Math.round((remainingCash / 2000) * 100));

  switch (label) {
    case "Excellent":
      return {
        label,
        progressPercent,
        bar: "bg-emerald-400",
        text: "text-emerald-300",
        border: "border-emerald-500/20",
        bg: "bg-emerald-500/10",
      };
    case "Good":
      return {
        label,
        progressPercent,
        bar: "bg-teal-400",
        text: "text-teal-300",
        border: "border-teal-500/20",
        bg: "bg-teal-500/10",
      };
    case "Caution":
      return {
        label,
        progressPercent,
        bar: "bg-yellow-400",
        text: "text-yellow-300",
        border: "border-yellow-500/20",
        bg: "bg-yellow-500/10",
      };
    case "Low":
      return {
        label,
        progressPercent,
        bar: "bg-orange-400",
        text: "text-orange-300",
        border: "border-orange-500/20",
        bg: "bg-orange-500/10",
      };
    case "Danger":
      return {
        label,
        progressPercent,
        bar: "bg-red-400",
        text: "text-red-300",
        border: "border-red-500/20",
        bg: "bg-red-500/10",
      };
  }
}

function buildPurchaseIntelligence(params: {
  safeToSpend: number;
  safeToSpendAfterPurchase: number;
  purchaseCost: number;
  annualImpact: number;
  verdict: SpendingVerdict;
  checkingBalance: number;
  timelineEvents: TimelineEvent[];
  fullSimulation: FinancialTimelineResult;
}): {
  confidenceScoreBefore: number;
  confidenceScoreImpact: number;
  currentRemainingCash: number;
  remainingCashAfterPurchase: number;
  monthlyImpactAmount: number;
  annualImpactAmount: number;
  lowestBalanceBeforePurchase: number;
  lowestBalanceAfterPurchase: number;
  cushionLabel: CushionMeterLabel;
  cushionProgressPercent: number;
} {
  const baselineSimulation = runFinancialCalculation(
    params.checkingBalance,
    params.timelineEvents,
  );
  const baselineVerdict: SpendingVerdict = baselineSimulation.hasShortfall
    ? "Not Affordable"
    : "Affordable Now";
  const confidenceBefore = calculateFinancialConfidenceScore(
    baselineVerdict,
    params.safeToSpend,
    params.safeToSpend,
  );
  const confidenceAfter = calculateFinancialConfidenceScore(
    params.verdict,
    params.safeToSpend,
    params.safeToSpendAfterPurchase,
  );
  const cushion = getCushionMeter(params.safeToSpendAfterPurchase);

  return {
    confidenceScoreBefore: confidenceBefore.score,
    confidenceScoreImpact: confidenceAfter.score - confidenceBefore.score,
    currentRemainingCash: params.safeToSpend,
    remainingCashAfterPurchase: params.safeToSpendAfterPurchase,
    monthlyImpactAmount: -params.purchaseCost,
    annualImpactAmount: -params.annualImpact,
    lowestBalanceBeforePurchase: baselineSimulation.lowestBalance,
    lowestBalanceAfterPurchase: params.fullSimulation.lowestBalance,
    cushionLabel: cushion.label,
    cushionProgressPercent: cushion.progressPercent,
  };
}

function formatSignedCurrency(amount: number): string {
  if (amount >= 0) return `$${amount.toLocaleString()}`;
  return `-$${Math.abs(amount).toLocaleString()}`;
}

function parseTimelineEventSource(eventId: string): TimelineEventSource | null {
  if (eventId.startsWith("bill-")) {
    return { kind: "bill", billId: eventId.slice("bill-".length) };
  }

  if (eventId.startsWith("recurring-paycheck-")) {
    const remainder = eventId.slice("recurring-paycheck-".length);
    const occurrenceDate = remainder.slice(-10);
    const paycheckId = remainder.slice(0, -11);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate) || !paycheckId) {
      return null;
    }

    return { kind: "recurring-paycheck", paycheckId, occurrenceDate };
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
  const purchaseIntelligence = buildPurchaseIntelligence({
    safeToSpend,
    safeToSpendAfterPurchase,
    purchaseCost,
    annualImpact,
    verdict,
    checkingBalance,
    timelineEvents,
    fullSimulation,
  });

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
    confidenceScoreBefore: purchaseIntelligence.confidenceScoreBefore,
    confidenceScoreImpact: purchaseIntelligence.confidenceScoreImpact,
    currentRemainingCash: purchaseIntelligence.currentRemainingCash,
    remainingCashAfterPurchase: purchaseIntelligence.remainingCashAfterPurchase,
    monthlyImpactAmount: purchaseIntelligence.monthlyImpactAmount,
    annualImpactAmount: purchaseIntelligence.annualImpactAmount,
    lowestBalanceBeforePurchase: purchaseIntelligence.lowestBalanceBeforePurchase,
    lowestBalanceAfterPurchase: purchaseIntelligence.lowestBalanceAfterPurchase,
    cushionLabel: purchaseIntelligence.cushionLabel,
    cushionProgressPercent: purchaseIntelligence.cushionProgressPercent,
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
    confidenceScoreBefore:
      result.confidenceScoreBefore ?? confidence.score,
    confidenceScoreImpact: result.confidenceScoreImpact ?? 0,
    currentRemainingCash:
      result.currentRemainingCash ?? currentSafeToSpend,
    remainingCashAfterPurchase:
      result.remainingCashAfterPurchase ?? safeToSpendAfterPurchase,
    monthlyImpactAmount:
      result.monthlyImpactAmount ?? -purchaseCost,
    annualImpactAmount: result.annualImpactAmount ?? -annualImpact,
    lowestBalanceBeforePurchase: result.lowestBalanceBeforePurchase ?? 0,
    lowestBalanceAfterPurchase:
      result.lowestBalanceAfterPurchase ??
      result.projectedBalance ??
      safeToSpendAfterPurchase,
    cushionLabel: result.cushionLabel ?? getCushionMeter(safeToSpendAfterPurchase).label,
    cushionProgressPercent:
      result.cushionProgressPercent ??
      getCushionMeter(safeToSpendAfterPurchase).progressPercent,
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

type RecurringPaycheck = {
  id: string;
  name: string;
  amount: number;
  frequency: RecurringFrequency;
  firstPayDate: string;
  futurePaycheckCount: number;
  skippedDates?: string[];
};

type UpcomingPaycheck = {
  payDate: string;
  name: string;
  amount: number;
};

type SpendingTransaction = {
  id: string;
  name: string;
  amount: number;
};

type SpendingCategory = {
  id: string;
  name: string;
  monthlyBudget: number;
  transactions: SpendingTransaction[];
};

const DEFAULT_SPENDING_CATEGORY_NAMES = [
  "Food",
  "Gas",
  "Entertainment",
  "Shopping",
  "Health",
  "Subscriptions",
  "Miscellaneous",
] as const;

function createDefaultSpendingCategories(): SpendingCategory[] {
  return DEFAULT_SPENDING_CATEGORY_NAMES.map((name) => ({
    id: crypto.randomUUID(),
    name,
    monthlyBudget: 0,
    transactions: [],
  }));
}

function getCategoryAmountSpent(category: SpendingCategory): number {
  return category.transactions.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  );
}

function getCategoryAmountRemaining(category: SpendingCategory): number {
  return category.monthlyBudget - getCategoryAmountSpent(category);
}

function getCategoryPercentUsed(category: SpendingCategory): number {
  if (category.monthlyBudget <= 0) {
    return getCategoryAmountSpent(category) > 0 ? 100 : 0;
  }

  return Math.round(
    (getCategoryAmountSpent(category) / category.monthlyBudget) * 100,
  );
}

function getSpendingProgressBarColor(percentUsed: number): string {
  if (percentUsed >= 100) return "bg-red-500";
  if (percentUsed >= 75) return "bg-yellow-500";
  return "bg-emerald-500";
}

type SpendingCategoryStatus = "On Track" | "Watch" | "Over Budget";

function getSpendingCategoryStatus(
  percentUsed: number,
): SpendingCategoryStatus {
  if (percentUsed >= 100) return "Over Budget";
  if (percentUsed >= 75) return "Watch";
  return "On Track";
}

const spendingCategoryStatusStyles: Record<
  SpendingCategoryStatus,
  { badge: string; badgeText: string; cardBorder: string }
> = {
  "On Track": {
    badge: "bg-emerald-500/20",
    badgeText: "text-emerald-300",
    cardBorder: "border-emerald-500/20",
  },
  Watch: {
    badge: "bg-yellow-500/20",
    badgeText: "text-yellow-300",
    cardBorder: "border-yellow-500/20",
  },
  "Over Budget": {
    badge: "bg-red-500/20",
    badgeText: "text-red-300",
    cardBorder: "border-red-500/20",
  },
};

function getTotalMonthlySpendingBudget(categories: SpendingCategory[]): number {
  return categories.reduce((sum, category) => sum + category.monthlyBudget, 0);
}

function getTotalMonthlySpendingSpent(categories: SpendingCategory[]): number {
  return categories.reduce(
    (sum, category) => sum + getCategoryAmountSpent(category),
    0,
  );
}

function getTotalMonthlySpendingRemaining(
  categories: SpendingCategory[],
): number {
  return (
    getTotalMonthlySpendingBudget(categories) -
    getTotalMonthlySpendingSpent(categories)
  );
}

function isSpendingCategoryActive(category: SpendingCategory): boolean {
  return category.monthlyBudget > 0 || category.transactions.length > 0;
}

function getVisibleSpendingCategories(
  categories: SpendingCategory[],
): SpendingCategory[] {
  return categories.filter(isSpendingCategoryActive);
}

function getActiveSpendingCategoryCount(categories: SpendingCategory[]): number {
  return getVisibleSpendingCategories(categories).length;
}

function getSpendingProgressBarWidth(
  amountSpent: number,
  monthlyBudget: number,
): number {
  if (monthlyBudget > 0) {
    return Math.min(100, (amountSpent / monthlyBudget) * 100);
  }

  return amountSpent > 0 ? 100 : 0;
}

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
  plannedPaychecks: PlannedPaycheck[],
  recurringPaychecks: RecurringPaycheck[] = [],
): UpcomingPaycheck | null {
  const today = toISODate(new Date());
  const manual = plannedPaychecks
    .filter((paycheck) => paycheck.payDate >= today)
    .map((paycheck) => ({
      payDate: paycheck.payDate,
      name: paycheck.name,
      amount: paycheck.amount,
    }));
  const recurring = recurringPaychecks.flatMap((paycheck) =>
    getRecurringPaycheckOccurrences(paycheck, today).map((payDate) => ({
      payDate,
      name: paycheck.name,
      amount: paycheck.amount,
    })),
  );
  const upcoming = [...manual, ...recurring].sort((a, b) =>
    a.payDate.localeCompare(b.payDate),
  );
  return upcoming[0] ?? null;
}

function advanceRecurringPaycheckDate(
  date: Date,
  frequency: RecurringFrequency,
  anchorDay: number,
): void {
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

function getRecurringPaycheckOccurrences(
  paycheck: RecurringPaycheck,
  todayISO: string,
  horizonISO?: string,
): string[] {
  const targetCount = paycheck.futurePaycheckCount || 6;
  const dates: string[] = [];
  const [year, month, day] = paycheck.firstPayDate.split("-").map(Number);
  const occurrence = new Date(year, month - 1, day);
  occurrence.setHours(0, 0, 0, 0);

  let iterations = 0;
  const maxIterations = targetCount + 104;

  while (dates.length < targetCount && iterations < maxIterations) {
    iterations++;
    const iso = toISODate(occurrence);

    if (
      iso >= todayISO &&
      (!horizonISO || iso <= horizonISO) &&
      !paycheck.skippedDates?.includes(iso)
    ) {
      dates.push(iso);
    }

    advanceRecurringPaycheckDate(occurrence, paycheck.frequency, day);
  }

  return dates;
}

function formatRecurringPaycheckSchedule(paycheck: RecurringPaycheck): string {
  return `${paycheck.frequency} · First pay ${formatDueDate(paycheck.firstPayDate)} · ${paycheck.futurePaycheckCount} paychecks`;
}

function getSafeToSpendHorizonEnd(
  plannedPaychecks: PlannedPaycheck[],
  recurringPaychecks: RecurringPaycheck[] = [],
): Date {
  const todayISO = toISODate(new Date());
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const horizonEnd = new Date(today);
  horizonEnd.setDate(horizonEnd.getDate() + 30);

  const upcomingDates = [
    ...plannedPaychecks
      .filter((paycheck) => paycheck.payDate >= todayISO)
      .map((paycheck) => paycheck.payDate),
    ...recurringPaychecks.flatMap((paycheck) =>
      getRecurringPaycheckOccurrences(paycheck, todayISO),
    ),
  ].sort();

  if (upcomingDates.length > 0) {
    const lastDate = upcomingDates[upcomingDates.length - 1];
    const [year, month, day] = lastDate.split("-").map(Number);
    const lastPayDate = new Date(year, month - 1, day);
    if (lastPayDate > horizonEnd) {
      horizonEnd.setTime(lastPayDate.getTime());
    }
  }

  const nextPaycheck = getNextUpcomingPaycheck(
    plannedPaychecks,
    recurringPaychecks,
  );
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
  recurringPaychecks: RecurringPaycheck[],
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

  const manualPaycheckEvents: TimelineEvent[] = plannedPaychecks
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

  const recurringPaycheckEvents = recurringPaychecks.flatMap((paycheck) =>
    getRecurringPaycheckOccurrences(paycheck, todayISO, horizonISO).map(
      (date) => ({
        id: `recurring-paycheck-${paycheck.id}-${date}`,
        name: paycheck.name,
        amount: paycheck.amount,
        date,
        type: "Income" as const,
      }),
    ),
  );

  const manualEvents = timelineEvents.filter(
    (event) => event.date >= todayISO && event.date <= horizonISO,
  );

  return [
    ...billEvents,
    ...recurringEvents,
    ...manualPaycheckEvents,
    ...recurringPaycheckEvents,
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

function addDaysToISO(daysFromToday: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + daysFromToday);
  return toISODate(date);
}

function createDemoPersistedData(): PersistedAppData {
  return {
    checkingBalance: "2450",
    profile: { name: "Alex", email: "demo@example.com" },
    plannedBills: [
      {
        id: "demo-bill-1",
        name: "Car Insurance",
        amount: 145,
        dueDate: addDaysToISO(8),
      },
    ],
    recurringBills: [
      {
        id: "demo-bill-rent",
        name: "Rent",
        amount: 1200,
        dueDay: 1,
        frequency: "Monthly",
      },
      {
        id: "demo-bill-netflix",
        name: "Netflix",
        amount: 15.99,
        dueDay: 12,
        frequency: "Monthly",
      },
      {
        id: "demo-bill-gym",
        name: "Gym Membership",
        amount: 45,
        dueDay: 15,
        frequency: "Monthly",
      },
    ],
    recurringPaychecks: [
      {
        id: "demo-paycheck-rec",
        name: "Biweekly Pay",
        amount: 1850,
        frequency: "Biweekly",
        firstPayDate: addDaysToISO(5),
        futurePaycheckCount: 6,
      },
    ],
    plannedPaychecks: [],
    spendingCategories: [
      {
        id: "demo-cat-food",
        name: "Food",
        monthlyBudget: 600,
        transactions: [
          { id: "demo-tx-1", name: "Walmart", amount: 125 },
          { id: "demo-tx-2", name: "Costco", amount: 150 },
          { id: "demo-tx-3", name: "Starbucks", amount: 15 },
        ],
      },
      {
        id: "demo-cat-gas",
        name: "Gas",
        monthlyBudget: 200,
        transactions: [{ id: "demo-tx-4", name: "Shell", amount: 52 }],
      },
      {
        id: "demo-cat-ent",
        name: "Entertainment",
        monthlyBudget: 150,
        transactions: [{ id: "demo-tx-5", name: "AMC Theaters", amount: 38 }],
      },
      {
        id: "demo-cat-shop",
        name: "Shopping",
        monthlyBudget: 300,
        transactions: [{ id: "demo-tx-6", name: "Target", amount: 64 }],
      },
      {
        id: "demo-cat-health",
        name: "Health",
        monthlyBudget: 100,
        transactions: [],
      },
      {
        id: "demo-cat-sub",
        name: "Subscriptions",
        monthlyBudget: 75,
        transactions: [{ id: "demo-tx-7", name: "Spotify", amount: 11.99 }],
      },
      {
        id: "demo-cat-misc",
        name: "Miscellaneous",
        monthlyBudget: 100,
        transactions: [],
      },
    ],
    savingsGoals: [
      {
        id: "demo-goal-1",
        name: "Emergency Fund",
        targetAmount: 5000,
        currentSaved: 1200,
        isPrimary: true,
      },
    ],
    timelineEvents: [
      {
        id: "planned-purchase-demo-1",
        name: "New Headphones",
        amount: 89,
        date: addDaysToISO(3),
        type: "Expense",
      },
    ],
    purchaseName: "",
    purchaseAmount: "",
    purchaseDate: "",
    purchaseType: "One-Time",
    spendingDecisionResult: null,
    goalName: "Emergency Fund",
    goalAmount: "5000",
    currentSaved: "1200",
    monthlyContribution: "200",
    savingsGoalCalculated: false,
    billName: "",
    billAmount: "",
    billDueDate: "",
    billFormType: "one-time",
    monthlyIncome: "",
    monthlyExpenses: "",
    monthlyBufferCalculated: false,
    emergencyMonthlyExpenses: "",
    emergencyCurrentSavings: "",
    emergencyFundCalculated: false,
    coachCurrentSavings: "1200",
    coachSavingsGoal: "5000",
    coachMonthlySavings: "200",
    coachAdviceShown: false,
    eventName: "",
    eventAmount: "",
    eventDate: "",
    eventType: "Expense",
    recurringBillName: "",
    recurringBillAmount: "",
    recurringDueDay: "1",
    recurringFirstDueDate: "",
    recurringFrequency: "Monthly",
    paycheckName: "",
    paycheckAmount: "",
    paycheckDate: "",
    paycheckFormType: "manual",
    recurringPaycheckFrequency: "Biweekly",
    recurringPaycheckFirstPayDate: "",
    recurringPaycheckFutureCount: "6",
    spendingCategoryName: "",
    spendingCategoryBudget: "",
  };
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
    const monthCursor = new Date(startDay.getFullYear(), startDay.getMonth(), 1);
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
  hasSetupData: boolean,
): {
  status: "Healthy" | "Shortfall Expected" | "Setup Needed";
  headline: string;
  detail: string;
} {
  if (!hasSetupData) {
    return {
      status: "Setup Needed",
      headline: "Let's get you set up.",
      detail:
        "Add your checking balance, paychecks, and bills below to unlock your cash flow outlook.",
    };
  }

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
  paycheckFormType?: PaycheckFormType;
  recurringPaychecks?: RecurringPaycheck[];
  recurringPaycheckFrequency?: RecurringFrequency;
  recurringPaycheckFirstPayDate?: string;
  recurringPaycheckFutureCount?: string;
  spendingCategories?: SpendingCategory[];
  spendingCategoryName?: string;
  spendingCategoryBudget?: string;
  checkingBalance: string;
  profile: UserProfile;
};

const STORAGE_KEY = "financial-confidence-data";
const LANGUAGE_STORAGE_KEY = "financial-confidence-language";

type AppLanguage = "en" | "es";

const APP_LABELS = {
  en: {
    dashboard: "Dashboard",
    bills: "Bills",
    paychecks: "Paychecks",
    monthlySpendingPlan: "Monthly Spending Plan",
    cashFlowTimeline: "Cash Flow Timeline",
    goalsAndPlanning: "Goals & Planning",
    financialConfidenceAssistant: "Financial Confidence Assistant",
    currentBalance: "Current Balance",
    nextPaycheck: "Next Paycheck",
    safeToSpend: "Safe To Spend",
    savingsGoal: "Savings Goal",
    addBill: "Add Bill",
    addPaycheck: "Add Paycheck",
    addCategory: "Add Category",
    addGoal: "Add Goal",
    knowBeforeYouBuy: "Know before you buy",
    language: "Language",
    selectLanguage: "Select Language",
    english: "English",
    spanish: "Español",
  },
  es: {
    dashboard: "Panel",
    bills: "Facturas",
    paychecks: "Pagos",
    monthlySpendingPlan: "Plan de Gastos Mensual",
    cashFlowTimeline: "Línea de Tiempo de Flujo de Efectivo",
    goalsAndPlanning: "Metas y Planificación",
    financialConfidenceAssistant: "Asistente de Confianza Financiera",
    currentBalance: "Saldo Actual",
    nextPaycheck: "Próximo Pago",
    safeToSpend: "Seguro para Gastar",
    savingsGoal: "Meta de Ahorro",
    addBill: "Agregar Factura",
    addPaycheck: "Agregar Pago",
    addCategory: "Agregar Categoría",
    addGoal: "Agregar Meta",
    knowBeforeYouBuy: "Sabe antes de comprar",
    language: "Idioma",
    selectLanguage: "Seleccionar idioma",
    english: "English",
    spanish: "Español",
  },
} as const;

function loadLanguage(): AppLanguage {
  if (typeof window === "undefined") return "en";

  try {
    const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return raw === "es" ? "es" : "en";
  } catch {
    return "en";
  }
}

function saveLanguage(language: AppLanguage): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Ignore storage quota or privacy mode errors.
  }
}

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

type AppBackupFile = {
  version: 1;
  exportedAt: string;
  language: AppLanguage;
  data: PersistedAppData;
};

type LegacyPersistedInput = PersistedAppData & {
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

function parseImportedBackup(
  raw: unknown,
): { data: PersistedAppData; language: AppLanguage } | null {
  if (!raw || typeof raw !== "object") return null;

  const record = raw as Record<string, unknown>;

  if (record.version === 1 && record.data && typeof record.data === "object") {
    return {
      data: record.data as PersistedAppData,
      language: record.language === "es" ? "es" : "en",
    };
  }

  if (
    "plannedBills" in record ||
    "checkingBalance" in record ||
    "savingsGoals" in record
  ) {
    return {
      data: record as PersistedAppData,
      language: loadLanguage(),
    };
  }

  return null;
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
  "Healthy" | "Tight" | "Shortfall Expected" | "Setup Needed",
  { badgeText: string; border: string; bg: string; detail: string }
> = {
  Healthy: {
    badgeText: "text-emerald-300",
    border: "border-emerald-500/20",
    bg: "bg-emerald-500/10",
    detail: "text-emerald-200",
  },
  Tight: {
    badgeText: "text-yellow-300",
    border: "border-yellow-500/20",
    bg: "bg-yellow-500/10",
    detail: "text-yellow-200",
  },
  "Shortfall Expected": {
    badgeText: "text-red-300",
    border: "border-red-500/30",
    bg: "bg-red-500/10",
    detail: "text-red-200",
  },
  "Setup Needed": {
    badgeText: "text-blue-300",
    border: "border-blue-500/20",
    bg: "bg-blue-500/10",
    detail: "text-blue-200",
  },
};

type SectionKey =
  | "dashboardSummary"
  | "bills"
  | "paychecks"
  | "monthlySpendingPlan"
  | "cashFlowTimeline"
  | "goalsAndPlanning"
  | "spendingDecision";

type ProfileModal =
  | "account"
  | "profile"
  | "settings"
  | "language"
  | "loadSampleData"
  | null;

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
  const [paycheckFormType, setPaycheckFormType] =
    useState<PaycheckFormType>("manual");
  const [recurringPaychecks, setRecurringPaychecks] = useState<
    RecurringPaycheck[]
  >([]);
  const [recurringPaycheckFrequency, setRecurringPaycheckFrequency] =
    useState<RecurringFrequency>("Biweekly");
  const [recurringPaycheckFirstPayDate, setRecurringPaycheckFirstPayDate] =
    useState("");
  const [recurringPaycheckFutureCount, setRecurringPaycheckFutureCount] =
    useState("6");
  const [spendingCategories, setSpendingCategories] = useState<
    SpendingCategory[]
  >([]);
  const [spendingCategoryName, setSpendingCategoryName] = useState("");
  const [spendingCategoryBudget, setSpendingCategoryBudget] = useState("");
  const [editingSpendingCategoryId, setEditingSpendingCategoryId] = useState<
    string | null
  >(null);
  const [spendingTransactionDrafts, setSpendingTransactionDrafts] = useState<
    Record<string, { name: string; amount: string }>
  >({});
  const [spendingCategoryExpanded, setSpendingCategoryExpanded] = useState<
    Record<string, boolean>
  >({});
  const [spendingTransactionFormOpen, setSpendingTransactionFormOpen] =
    useState<Record<string, boolean>>({});
  const spendingCategoryFormRef = useRef<HTMLFormElement>(null);
  const [checkingBalance, setCheckingBalance] = useState("");
  const [timelineFilter, setTimelineFilter] = useState<
    "all" | "income" | "expense"
  >("all");
  const [timelineSearch, setTimelineSearch] = useState("");
  const [sectionOpen, setSectionOpen] = useState<Record<SectionKey, boolean>>({
    dashboardSummary: true,
    bills: false,
    paychecks: false,
    monthlySpendingPlan: false,
    cashFlowTimeline: false,
    goalsAndPlanning: false,
    spendingDecision: false,
  });
  const [isHydrated, setIsHydrated] = useState(false);
  const [language, setLanguage] = useState<AppLanguage>(() => loadLanguage());
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileModal, setProfileModal] = useState<ProfileModal>(null);
  const [profileMessage, setProfileMessage] = useState("");
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const profileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const profileMenuPanelRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [profileMenuCoords, setProfileMenuCoords] = useState<ProfileMenuCoords>({
    top: 0,
    left: 0,
    placement: "bottom",
  });
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [editingRecurringBillId, setEditingRecurringBillId] = useState<
    string | null
  >(null);
  const [editingRecurringPaycheckId, setEditingRecurringPaycheckId] = useState<
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
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const actionMessageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const showActionMessage = (message: string) => {
    if (actionMessageTimeoutRef.current) {
      clearTimeout(actionMessageTimeoutRef.current);
    }

    setActionMessage(message);
    actionMessageTimeoutRef.current = setTimeout(() => {
      setActionMessage(null);
    }, 3500);
  };

  const openAppSection = (key: SectionKey) => {
    setSectionOpen((prev) => ({ ...prev, [key]: true }));

    const sectionIds: Record<SectionKey, string> = {
      dashboardSummary: "dashboard-summary",
      bills: "bills",
      paychecks: "paychecks",
      monthlySpendingPlan: "monthly-spending-plan",
      cashFlowTimeline: "cash-flow-timeline",
      goalsAndPlanning: "goals-and-planning",
      spendingDecision: "financial-confidence-assistant",
    };

    requestAnimationFrame(() => {
      document
        .getElementById(sectionIds[key])
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const toggleSection = (key: SectionKey) => {
    setSectionOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const profileDisplayName =
    (authUser ? getUserDisplayName(authUser) : "") ||
    profile.name.trim() ||
    "Account";
  const labels = APP_LABELS[language];

  const applyAuthUserToProfile = (user: User) => {
    const displayName = getUserDisplayName(user);
    const email = user.email ?? "";
    setProfile((prev) => ({
      name: displayName || prev.name,
      email: email || prev.email,
    }));

    const preferredLanguage = getUserLanguagePreference(user);
    if (preferredLanguage) {
      setLanguage(preferredLanguage);
      saveLanguage(preferredLanguage);
    }
  };

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return;
    }

    let mounted = true;
    const supabase = createClient();
    if (!supabase) {
      return;
    }

    supabaseRef.current = supabase;

    const loadSession = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!mounted) return;

      setAuthUser(user);
      if (user) {
        applyAuthUserToProfile(user);
      }
    };

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      setAuthUser(user);
      if (user) {
        applyAuthUserToProfile(user);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const selectLanguage = async (nextLanguage: AppLanguage) => {
    setLanguage(nextLanguage);
    saveLanguage(nextLanguage);
    setProfileModal(null);
    setProfileMenuOpen(false);

    if (authUser && supabaseRef.current) {
      await supabaseRef.current.auth.updateUser({
        data: { language_preference: nextLanguage },
      });
    }
  };

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
    paycheckFormType,
    recurringPaychecks,
    recurringPaycheckFrequency,
    recurringPaycheckFirstPayDate,
    recurringPaycheckFutureCount,
    spendingCategories,
    spendingCategoryName,
    spendingCategoryBudget,
    checkingBalance,
    profile,
  };
  };

  const applyPersistedData = (saved: PersistedAppData) => {
    const legacySaved = saved as LegacyPersistedInput;

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
    setPaycheckFormType(legacySaved.paycheckFormType ?? "manual");
    setRecurringPaychecks(legacySaved.recurringPaychecks ?? []);
    setRecurringPaycheckFrequency(
      legacySaved.recurringPaycheckFrequency ?? "Biweekly",
    );
    setRecurringPaycheckFirstPayDate(
      legacySaved.recurringPaycheckFirstPayDate ?? "",
    );
    setRecurringPaycheckFutureCount(
      legacySaved.recurringPaycheckFutureCount ?? "6",
    );
    setSpendingCategories(
      legacySaved.spendingCategories ?? createDefaultSpendingCategories(),
    );
    setSpendingCategoryName(legacySaved.spendingCategoryName ?? "");
    setSpendingCategoryBudget(legacySaved.spendingCategoryBudget ?? "");

    const loadedProfile = legacySaved.profile;
    setProfile({
      name: loadedProfile?.name ?? "",
      email: loadedProfile?.email ?? "",
    });

    setEditingGoalId(null);
    setGoalFormName("");
    setGoalFormTarget("");
    setGoalFormSaved("");
    setGoalFormIsPrimary(false);
    setEditingBillId(null);
    setEditingRecurringBillId(null);
    setEditingPaycheckId(null);
    setEditingRecurringPaycheckId(null);
    setEditingTimelineEventId(null);
    setEditingSpendingCategoryId(null);
    setSpendingTransactionDrafts({});
    setSpendingCategoryExpanded({});
    setSpendingTransactionFormOpen({});
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

  useEffect(() => {
    return () => {
      if (actionMessageTimeoutRef.current) {
        clearTimeout(actionMessageTimeoutRef.current);
      }
    };
  }, []);

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
    recurringPaychecks.length > 0 ||
    purchaseAmount !== "" ||
    spendingDecisionResult !== null;

  const hasCoreSetupData =
    checkingBalance !== "" ||
    plannedBills.length > 0 ||
    recurringBills.length > 0 ||
    plannedPaychecks.length > 0 ||
    recurringPaychecks.length > 0;

  const timelineHorizonEnd = getSafeToSpendHorizonEnd(
    plannedPaychecks,
    recurringPaychecks,
  );
  const unifiedTimelineEvents = buildFinancialTimelineEvents(
    plannedBills,
    recurringBills,
    plannedPaychecks,
    recurringPaychecks,
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

    queueMicrotask(() => {
      if (saved) {
        applyPersistedData(saved);
      } else {
        setSpendingCategories(createDefaultSpendingCategories());
      }
      setIsHydrated(true);
    });
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
    paycheckFormType,
    recurringPaychecks,
    recurringPaycheckFrequency,
    recurringPaycheckFirstPayDate,
    recurringPaycheckFutureCount,
    spendingCategories,
    spendingCategoryName,
    spendingCategoryBudget,
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
    showActionMessage(
      editingGoalId ? "Goal updated." : "Goal added.",
    );
  };

  const deleteGoal = (goalId: string) => {
    const goal = savingsGoals.find((item) => item.id === goalId);
    if (!goal) return;

    if (
      !confirmAction(
        `Delete "${formatGoalName(goal.name)}"? This cannot be undone.`,
      )
    ) {
      return;
    }

    setSavingsGoals((prev) => prev.filter((item) => item.id !== goalId));
    if (editingGoalId === goalId) {
      cancelEditGoal();
    }
    showActionMessage(`Deleted ${formatGoalName(goal.name)}.`);
  };

  const setPrimaryGoal = (goalId: string) => {
    setSavingsGoals((prev) =>
      prev.map((goal) => ({
        ...goal,
        isPrimary: goal.id === goalId,
      })),
    );
  };

  const saveProfile = async () => {
    savePersistedData(getPersistedSnapshot());

    if (authUser && supabaseRef.current) {
      await supabaseRef.current.auth.updateUser({
        data: { full_name: profile.name.trim() },
      });
    }

    setProfileMessage("Account saved.");
    setProfileModal(null);
  };

  const handleLogout = async () => {
    if (supabaseRef.current) {
      await supabaseRef.current.auth.signOut();
    }
    setAuthUser(null);
    setProfileMenuOpen(false);
    setProfileModal(null);
    showActionMessage("Signed out successfully.");
  };

  const exportData = () => {
    const backup: AppBackupFile = {
      version: 1,
      exportedAt: new Date().toISOString(),
      language,
      data: getPersistedSnapshot(),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `financial-confidence-${toISODate(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setProfileMenuOpen(false);
    showActionMessage("Backup Downloaded");
  };

  const importData = () => {
    importInputRef.current?.click();
    setProfileMenuOpen(false);
  };

  const handleImportFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const imported = parseImportedBackup(parsed);

        if (!imported) {
          window.alert("Invalid backup file. Please choose a valid export.");
          return;
        }

        applyPersistedData(imported.data);
        setLanguage(imported.language);
        saveLanguage(imported.language);
        savePersistedData(imported.data);
        setProfileModal(null);
        showActionMessage("Backup Restored Successfully");
      } catch {
        window.alert("Invalid backup file. Please choose a valid export.");
      }
    };
    reader.readAsText(file);
  };

  const openLoadSampleDataModal = () => {
    setProfileMenuOpen(false);
    setProfileModal("loadSampleData");
  };

  const confirmLoadSampleData = () => {
    const demoData = createDemoPersistedData();
    applyPersistedData(demoData);
    setLanguage("en");
    saveLanguage("en");
    savePersistedData(demoData);
    setProfileModal(null);
    showActionMessage("✓ Sample Data Loaded Successfully");
  };

  const resetAllData = () => {
    if (
      !confirmAction(
        "Reset all data? This clears your bills, paychecks, goals, and profile.",
      )
    ) {
      return;
    }

    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
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
    setPaycheckFormType("manual");
    setRecurringPaychecks([]);
    setRecurringPaycheckFrequency("Biweekly");
    setRecurringPaycheckFirstPayDate("");
    setRecurringPaycheckFutureCount("6");
    setEditingRecurringPaycheckId(null);
    setEditingPaycheckId(null);
    setSpendingCategories(createDefaultSpendingCategories());
    setSpendingCategoryName("");
    setSpendingCategoryBudget("");
    setEditingSpendingCategoryId(null);
    setSpendingTransactionDrafts({});
    setSpendingCategoryExpanded({});
    setSpendingTransactionFormOpen({});
    setCheckingBalance("");
    setProfile(DEFAULT_PROFILE);
    setProfileMessage("");
    setProfileMenuOpen(false);
    setProfileModal(null);
    setLanguage("en");
    showActionMessage("✓ Data Reset Successfully");
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
    showActionMessage(editingBillId ? "Bill updated." : "Bill added.");
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
    showActionMessage(
      editingRecurringBillId
        ? "Recurring bill updated."
        : "Recurring bill added.",
    );
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

  const removeBill = (id: string, options?: { skipConfirm?: boolean }) => {
    const bill = plannedBills.find((item) => item.id === id);
    if (!bill) return;

    if (
      !options?.skipConfirm &&
      !confirmAction(
        `Delete "${bill.name}"? This removes it from your bills and timeline.`,
      )
    ) {
      return;
    }

    setPlannedBills((prev) => prev.filter((item) => item.id !== id));
    if (editingBillId === id) {
      resetBillFormFields();
    }

    if (!options?.skipConfirm) {
      showActionMessage(`Deleted ${bill.name}.`);
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
    const bill = recurringBills.find((item) => item.id === id);
    if (!bill) return;

    if (
      !confirmAction(
        `Delete recurring bill "${bill.name}"? This removes all future occurrences.`,
      )
    ) {
      return;
    }

    setRecurringBills((prev) => prev.filter((item) => item.id !== id));
    if (editingRecurringBillId === id) {
      resetBillFormFields();
    }
    showActionMessage(`Deleted ${bill.name}.`);
  };

  const resetPaycheckFormFields = () => {
    setPaycheckName("");
    setPaycheckAmount("");
    setPaycheckDate("");
    setRecurringPaycheckFrequency("Biweekly");
    setRecurringPaycheckFirstPayDate("");
    setRecurringPaycheckFutureCount("6");
    setEditingPaycheckId(null);
    setEditingRecurringPaycheckId(null);
  };

  const handlePaycheckFormTypeChange = (type: PaycheckFormType) => {
    setPaycheckFormType(type);
    setEditingPaycheckId(null);
    setEditingRecurringPaycheckId(null);
  };

  const saveManualPaycheck = () => {
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
    } else {
      setPlannedPaychecks((prev) => [
        ...prev,
        { id: crypto.randomUUID(), name, amount, payDate },
      ]);
    }

    resetPaycheckFormFields();
    showActionMessage(
      editingPaycheckId ? "Paycheck updated." : "Paycheck added.",
    );
  };

  const saveRecurringPaycheck = () => {
    const name = paycheckName.trim();
    const amount = Number(paycheckAmount);
    const firstPayDate = recurringPaycheckFirstPayDate.trim();
    const futureCount = Number(recurringPaycheckFutureCount);

    if (
      !name ||
      !firstPayDate ||
      Number.isNaN(amount) ||
      amount <= 0 ||
      Number.isNaN(futureCount) ||
      futureCount < 1
    ) {
      return;
    }

    const recurringPayload = {
      name,
      amount,
      frequency: recurringPaycheckFrequency,
      firstPayDate,
      futurePaycheckCount: Math.round(futureCount),
    };

    if (editingRecurringPaycheckId) {
      setRecurringPaychecks((prev) =>
        prev.map((paycheck) =>
          paycheck.id === editingRecurringPaycheckId
            ? { ...paycheck, ...recurringPayload }
            : paycheck,
        ),
      );
    } else {
      setRecurringPaychecks((prev) => [
        ...prev,
        { id: crypto.randomUUID(), ...recurringPayload },
      ]);
    }

    resetPaycheckFormFields();
    showActionMessage(
      editingRecurringPaycheckId
        ? "Recurring paycheck updated."
        : "Recurring paycheck added.",
    );
  };

  const savePaycheck = () => {
    if (paycheckFormType === "manual") {
      saveManualPaycheck();
    } else {
      saveRecurringPaycheck();
    }
  };

  const startEditPaycheck = (paycheck: PlannedPaycheck) => {
    setPaycheckFormType("manual");
    setEditingRecurringPaycheckId(null);
    setEditingPaycheckId(paycheck.id);
    setPaycheckName(paycheck.name);
    setPaycheckAmount(String(paycheck.amount));
    setPaycheckDate(paycheck.payDate);
  };

  const removePaycheck = (id: string, options?: { skipConfirm?: boolean }) => {
    const paycheck = plannedPaychecks.find((item) => item.id === id);
    if (!paycheck) return;

    if (
      !options?.skipConfirm &&
      !confirmAction(
        `Delete "${paycheck.name}"? This removes it from your paychecks and timeline.`,
      )
    ) {
      return;
    }

    setPlannedPaychecks((prev) => prev.filter((item) => item.id !== id));
    if (editingPaycheckId === id) {
      resetPaycheckFormFields();
    }

    if (!options?.skipConfirm) {
      showActionMessage(`Deleted ${paycheck.name}.`);
    }
  };

  const startEditRecurringPaycheck = (paycheck: RecurringPaycheck) => {
    setPaycheckFormType("recurring");
    setEditingPaycheckId(null);
    setEditingRecurringPaycheckId(paycheck.id);
    setPaycheckName(paycheck.name);
    setPaycheckAmount(String(paycheck.amount));
    setRecurringPaycheckFrequency(paycheck.frequency);
    setRecurringPaycheckFirstPayDate(paycheck.firstPayDate);
    setRecurringPaycheckFutureCount(String(paycheck.futurePaycheckCount));
  };

  const removeRecurringPaycheck = (id: string) => {
    const paycheck = recurringPaychecks.find((item) => item.id === id);
    if (!paycheck) return;

    if (
      !confirmAction(
        `Delete recurring paycheck "${paycheck.name}"? This removes all future occurrences.`,
      )
    ) {
      return;
    }

    setRecurringPaychecks((prev) => prev.filter((item) => item.id !== id));
    if (editingRecurringPaycheckId === id) {
      resetPaycheckFormFields();
    }
    showActionMessage(`Deleted ${paycheck.name}.`);
  };

  const resetSpendingCategoryFormFields = () => {
    setSpendingCategoryName("");
    setSpendingCategoryBudget("");
    setEditingSpendingCategoryId(null);
  };

  const saveSpendingCategory = () => {
    const name = spendingCategoryName.trim();
    const monthlyBudget = Number(spendingCategoryBudget);

    if (!name || Number.isNaN(monthlyBudget) || monthlyBudget < 0) return;

    if (editingSpendingCategoryId) {
      setSpendingCategories((prev) =>
        prev.map((category) =>
          category.id === editingSpendingCategoryId
            ? { ...category, name, monthlyBudget }
            : category,
        ),
      );
    } else {
      setSpendingCategories((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          name,
          monthlyBudget,
          transactions: [],
        },
      ]);
    }

    resetSpendingCategoryFormFields();
    showActionMessage(
      editingSpendingCategoryId ? "Category updated." : "Category added.",
    );
  };

  const startEditSpendingCategory = (category: SpendingCategory) => {
    setEditingSpendingCategoryId(category.id);
    setSpendingCategoryName(category.name);
    setSpendingCategoryBudget(String(category.monthlyBudget));
  };

  const removeSpendingCategory = (id: string) => {
    const category = spendingCategories.find((item) => item.id === id);
    if (!category) return;

    if (
      !confirmAction(
        `Delete "${category.name}"? All transactions in this category will be removed.`,
      )
    ) {
      return;
    }

    setSpendingCategories((prev) => prev.filter((item) => item.id !== id));
    setSpendingTransactionDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSpendingCategoryExpanded((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSpendingTransactionFormOpen((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (editingSpendingCategoryId === id) {
      resetSpendingCategoryFormFields();
    }
    showActionMessage(`Deleted ${category.name}.`);
  };

  const getSpendingTransactionDraft = (categoryId: string) =>
    spendingTransactionDrafts[categoryId] ?? { name: "", amount: "" };

  const updateSpendingTransactionDraft = (
    categoryId: string,
    field: "name" | "amount",
    value: string,
  ) => {
    setSpendingTransactionDrafts((prev) => ({
      ...prev,
      [categoryId]: {
        ...(prev[categoryId] ?? { name: "", amount: "" }),
        [field]: value,
      },
    }));
  };

  const addSpendingTransaction = (categoryId: string) => {
    const draft = getSpendingTransactionDraft(categoryId);
    const name = draft.name.trim();
    const amount = Number(draft.amount);

    if (!name || Number.isNaN(amount) || amount <= 0) return;

    setSpendingCategories((prev) =>
      prev.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              transactions: [
                ...category.transactions,
                { id: crypto.randomUUID(), name, amount },
              ],
            }
          : category,
      ),
    );

    setSpendingTransactionDrafts((prev) => ({
      ...prev,
      [categoryId]: { name: "", amount: "" },
    }));
    showActionMessage("Transaction added.");
  };

  const removeSpendingTransaction = (
    categoryId: string,
    transactionId: string,
  ) => {
    const category = spendingCategories.find((item) => item.id === categoryId);
    const transaction = category?.transactions.find(
      (item) => item.id === transactionId,
    );
    if (!transaction) return;

    if (
      !confirmAction(`Delete "${transaction.name}" from this category?`)
    ) {
      return;
    }

    setSpendingCategories((prev) =>
      prev.map((item) =>
        item.id === categoryId
          ? {
              ...item,
              transactions: item.transactions.filter(
                (entry) => entry.id !== transactionId,
              ),
            }
          : item,
      ),
    );
    showActionMessage(`Deleted ${transaction.name}.`);
  };

  const isSpendingCategoryExpanded = (category: SpendingCategory): boolean => {
    if (category.id in spendingCategoryExpanded) {
      return spendingCategoryExpanded[category.id];
    }

    return category.transactions.length > 0;
  };

  const toggleSpendingCategoryExpanded = (category: SpendingCategory) => {
    setSpendingCategoryExpanded((prev) => ({
      ...prev,
      [category.id]: !isSpendingCategoryExpanded(category),
    }));
  };

  const openSpendingTransactionForm = (category: SpendingCategory) => {
    setSpendingCategoryExpanded((prev) => ({ ...prev, [category.id]: true }));
    setSpendingTransactionFormOpen((prev) => ({ ...prev, [category.id]: true }));

    requestAnimationFrame(() => {
      document
        .getElementById(`spending-transaction-name-${category.id}`)
        ?.focus();
    });
  };

  const focusSpendingCategoryForm = () => {
    spendingCategoryFormRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    document.getElementById("spending-category-name")?.focus();
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
    showActionMessage("Purchase added to your timeline.");
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

    if (!confirmAction(getTimelineDeleteConfirmMessage(event, source))) {
      return;
    }

    switch (source.kind) {
      case "bill":
        removeBill(source.billId, { skipConfirm: true });
        break;
      case "paycheck":
        removePaycheck(source.paycheckId, { skipConfirm: true });
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
      case "recurring-paycheck":
        setRecurringPaychecks((prev) =>
          prev.map((paycheck) =>
            paycheck.id === source.paycheckId
              ? {
                  ...paycheck,
                  skippedDates: Array.from(
                    new Set([
                      ...(paycheck.skippedDates ?? []),
                      source.occurrenceDate,
                    ]),
                  ),
                }
              : paycheck,
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

    showActionMessage(`Removed ${event.name} from timeline.`);
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
      case "recurring-paycheck": {
        const originalDate = source.occurrenceDate;
        if (type === "Income" && date === originalDate) {
          setRecurringPaychecks((prev) =>
            prev.map((paycheck) =>
              paycheck.id === source.paycheckId
                ? { ...paycheck, name, amount }
                : paycheck,
            ),
          );
        } else if (type === "Income") {
          setRecurringPaychecks((prev) =>
            prev.map((paycheck) =>
              paycheck.id === source.paycheckId
                ? {
                    ...paycheck,
                    skippedDates: Array.from(
                      new Set([...(paycheck.skippedDates ?? []), originalDate]),
                    ),
                  }
                : paycheck,
            ),
          );
          setPlannedPaychecks((prev) => [
            ...prev,
            { id: crypto.randomUUID(), name, amount, payDate: date },
          ]);
        } else {
          setRecurringPaychecks((prev) =>
            prev.map((paycheck) =>
              paycheck.id === source.paycheckId
                ? {
                    ...paycheck,
                    skippedDates: Array.from(
                      new Set([...(paycheck.skippedDates ?? []), originalDate]),
                    ),
                  }
                : paycheck,
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
    showActionMessage("Timeline event updated.");
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
    showActionMessage("Timeline event added.");
  };

  const clearTimeline = () => {
    if (timelineEvents.length === 0) return;

    if (
      !confirmAction(
        "Clear all manual timeline events? Bills and paychecks will remain on your timeline.",
      )
    ) {
      return;
    }

    setTimelineEvents([]);
    showActionMessage("Manual timeline events cleared.");
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
  const nextUpcomingPaycheck = getNextUpcomingPaycheck(
    plannedPaychecks,
    recurringPaychecks,
  );
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
    hasCoreSetupData,
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
  const timelineAvailableCash = cashFlowProjection
    ? cashFlowProjection.startingBalance + timelineTotals.income
    : 0;
  const timelineRemainingCash = cashFlowProjection?.endingBalance ?? 0;

  const totalSpendingBudget = getTotalMonthlySpendingBudget(spendingCategories);
  const totalSpendingSpent = getTotalMonthlySpendingSpent(spendingCategories);
  const totalSpendingRemaining =
    getTotalMonthlySpendingRemaining(spendingCategories);
  const visibleSpendingCategories =
    getVisibleSpendingCategories(spendingCategories);
  const activeSpendingCategoryCount =
    getActiveSpendingCategoryCount(spendingCategories);

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
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleImportFileChange}
      />
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
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-300 backdrop-blur-sm transition hover:border-white/20 hover:bg-white/[0.08]"
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
              className="fixed z-[200] w-52 rounded-xl border border-white/10 bg-slate-900 py-1 shadow-2xl shadow-black/40 backdrop-blur-xl"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setProfileModal("account");
                  setProfileMenuOpen(false);
                }}
                className="block w-full px-4 py-2.5 text-left text-sm text-slate-200 transition hover:bg-white/[0.06]"
              >
                My Account
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setProfileModal("profile");
                  setProfileMenuOpen(false);
                }}
                className="block w-full px-4 py-2.5 text-left text-sm text-slate-200 transition hover:bg-white/[0.06]"
              >
                Profile
              </button>

              <div
                className="my-1 border-t border-white/10"
                role="separator"
                aria-hidden="true"
              />

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setProfileModal("language");
                  setProfileMenuOpen(false);
                }}
                className="block w-full px-4 py-2.5 text-left text-sm text-slate-200 transition hover:bg-white/[0.06]"
              >
                {labels.language}
              </button>
              {authUser ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void handleLogout();
                  }}
                  className="block w-full px-4 py-2.5 text-left text-sm text-slate-200 transition hover:bg-white/[0.06]"
                >
                  Logout
                </button>
              ) : null}

              <div className="my-1" role="presentation" aria-hidden="true" />

              <button
                type="button"
                role="menuitem"
                onClick={exportData}
                className="block w-full px-4 py-2.5 text-left text-sm text-slate-200 transition hover:bg-white/[0.06]"
              >
                Export Data
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={importData}
                className="block w-full px-4 py-2.5 text-left text-sm text-slate-200 transition hover:bg-white/[0.06]"
              >
                Import Data
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={openLoadSampleDataModal}
                className="block w-full px-4 py-2.5 text-left text-sm text-slate-200 transition hover:bg-white/[0.06]"
              >
                Load Sample Data
              </button>

              <div
                className="my-1 border-t border-white/10"
                role="separator"
                aria-hidden="true"
              />

              <button
                type="button"
                role="menuitem"
                onClick={resetAllData}
                className="block w-full px-4 py-2.5 text-left text-sm text-red-300 transition hover:bg-red-500/10 hover:text-red-200"
              >
                Reset All Data
              </button>

              <div
                className="my-1 border-t border-white/10"
                role="separator"
                aria-hidden="true"
              />

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setProfileModal("settings");
                  setProfileMenuOpen(false);
                }}
                className="block w-full px-4 py-2.5 text-left text-sm text-slate-200 transition hover:bg-white/[0.06]"
              >
                Settings
              </button>
              <p className="px-4 pb-2 pt-1 text-xs text-slate-500">
                Version {APP_VERSION}
              </p>
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
              Know before you buy.
            </p>

            <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-500 lg:mx-0">
              Set up your bills, paychecks, and goals once — then use the
              Financial Confidence Assistant before every purchase.
            </p>

            {/* Stats */}
            <dl className="mt-10 grid grid-cols-1 gap-4 border-t border-white/10 pt-8 sm:grid-cols-3 sm:gap-6">
              {[
                { value: "Quick", label: "Setup" },
                { value: "Private", label: "Stored on your device" },
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
              {actionMessage ? (
                <div
                  role="status"
                  className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200"
                >
                  {actionMessage}
                </div>
              ) : null}

              <CollapsibleSection
                id="dashboard-summary"
                title={labels.dashboard}
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
                    {hasCoreSetupData
                      ? "Here's your cash flow outlook."
                      : "Complete the setup steps below to unlock your outlook."}
                  </p>
                </div>
                {!hasCoreSetupData ? (
                  <div className="mt-5 rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-4 sm:px-5">
                    <p className="text-sm font-semibold text-blue-200">
                      Quick setup
                    </p>
                    <ol className="mt-3 space-y-2 text-sm text-slate-300">
                      <li className="flex items-start gap-2">
                        <span className="font-semibold text-blue-300">1.</span>
                        <button
                          type="button"
                          onClick={() => openAppSection("cashFlowTimeline")}
                          className="text-left underline decoration-blue-400/40 underline-offset-2 transition hover:text-blue-200"
                        >
                          Enter your checking balance
                        </button>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="font-semibold text-blue-300">2.</span>
                        <button
                          type="button"
                          onClick={() => openAppSection("paychecks")}
                          className="text-left underline decoration-blue-400/40 underline-offset-2 transition hover:text-blue-200"
                        >
                          Add your paychecks
                        </button>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="font-semibold text-blue-300">3.</span>
                        <button
                          type="button"
                          onClick={() => openAppSection("bills")}
                          className="text-left underline decoration-blue-400/40 underline-offset-2 transition hover:text-blue-200"
                        >
                          Add your bills
                        </button>
                      </li>
                    </ol>
                  </div>
                ) : null}
                <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-400 sm:text-sm">
                      {labels.currentBalance}
                    </dt>
                    <dd className="mt-2 text-xl font-bold tabular-nums text-white sm:text-2xl">
                      {checkingBalance !== ""
                        ? `$${checkingBalanceAmount.toLocaleString()}`
                        : "Not set"}
                    </dd>
                    <dd className="mt-1 text-xs text-slate-500 sm:text-sm">
                      In your checking account today
                    </dd>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-400 sm:text-sm">
                      {labels.nextPaycheck}
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
                      {labels.safeToSpend}
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
                      {labels.savingsGoal}
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
                          <button
                            type="button"
                            onClick={() => openAppSection("goalsAndPlanning")}
                            className="underline decoration-violet-400/40 underline-offset-2 transition hover:text-violet-300"
                          >
                            Create a savings goal
                          </button>
                        </dd>
                      </>
                    )}
                  </div>
                </dl>
                <div
                  role="status"
                  className={`mt-5 rounded-xl border px-4 py-4 sm:px-5 sm:py-5 ${
                    dashboardStatusStyles[dashboardCashFlowLabel].border
                  } ${dashboardStatusStyles[dashboardCashFlowLabel].bg}`}
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
                      dashboardStatusStyles[dashboardCashFlowLabel].detail
                    }`}
                  >
                    {dashboardCashFlow.detail}
                  </p>
                </div>
              </CollapsibleSection>

              <CollapsibleSection
                id="bills"
                title={labels.bills}
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
                  <p className="text-sm leading-relaxed text-slate-400">
                    Bills feed your Cash Flow Timeline and Safe To Spend. Add
                    one-time or recurring bills to keep projections accurate.
                  </p>
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
                        : labels.addBill}
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
                                  className={`${TOUCH_TARGET_BUTTON_CLASS} border-white/10 text-slate-400 transition hover:border-red-500/40 hover:text-red-300`}
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
                      <p className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-slate-400">
                        No one-time bills yet. Add rent, utilities, or other
                        upcoming due dates above.
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
                                  className={`${TOUCH_TARGET_BUTTON_CLASS} border-white/10 text-slate-400 transition hover:border-red-500/40 hover:text-red-300`}
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
                      <p className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-slate-400">
                        No recurring bills yet. Add subscriptions, rent, or
                        other monthly expenses above.
                      </p>
                    )}
                  </div>
                </div>
              </CollapsibleSection>

              <CollapsibleSection
                id="paychecks"
                title={labels.paychecks}
                subtitle="Add manual or recurring paychecks — amounts can vary"
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
                <div className="space-y-6">
                  <p className="text-sm leading-relaxed text-slate-400">
                    Paychecks power your timeline and Safe To Spend. Recurring
                    paychecks automatically generate future income events.
                  </p>
                  <form
                    className="space-y-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      savePaycheck();
                    }}
                  >
                    <fieldset>
                      <legend className="mb-2 block text-sm font-medium text-slate-300">
                        Paycheck Type
                      </legend>
                      <div className="flex flex-wrap gap-4">
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                          <input
                            type="radio"
                            name="paycheck-type"
                            checked={paycheckFormType === "manual"}
                            onChange={() =>
                              handlePaycheckFormTypeChange("manual")
                            }
                            className="h-4 w-4 border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500/30"
                          />
                          Manual Paycheck
                        </label>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                          <input
                            type="radio"
                            name="paycheck-type"
                            checked={paycheckFormType === "recurring"}
                            onChange={() =>
                              handlePaycheckFormTypeChange("recurring")
                            }
                            className="h-4 w-4 border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500/30"
                          />
                          Recurring Paycheck
                        </label>
                      </div>
                    </fieldset>

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
                        Amount
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

                    {paycheckFormType === "manual" ? (
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
                          className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white transition focus:border-emerald-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 [color-scheme:dark]"
                        />
                      </div>
                    ) : (
                      <>
                        <div>
                          <label
                            htmlFor="recurring-paycheck-frequency"
                            className="mb-2 block text-sm font-medium text-slate-300"
                          >
                            Frequency
                          </label>
                          <select
                            id="recurring-paycheck-frequency"
                            value={recurringPaycheckFrequency}
                            onChange={(e) =>
                              setRecurringPaycheckFrequency(
                                e.target.value as RecurringFrequency,
                              )
                            }
                            className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white transition focus:border-emerald-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                          >
                            <option value="Weekly">Weekly</option>
                            <option value="Biweekly">Biweekly</option>
                            <option value="Monthly">Monthly</option>
                          </select>
                        </div>

                        <div>
                          <label
                            htmlFor="recurring-paycheck-first-date"
                            className="mb-2 block text-sm font-medium text-slate-300"
                          >
                            First Pay Date
                          </label>
                          <input
                            id="recurring-paycheck-first-date"
                            type="date"
                            value={recurringPaycheckFirstPayDate}
                            onChange={(e) =>
                              setRecurringPaycheckFirstPayDate(e.target.value)
                            }
                            className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white transition focus:border-emerald-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 [color-scheme:dark]"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="recurring-paycheck-future-count"
                            className="mb-2 block text-sm font-medium text-slate-300"
                          >
                            Number of Future Paychecks to Generate
                          </label>
                          <input
                            id="recurring-paycheck-future-count"
                            type="number"
                            min="1"
                            step="1"
                            placeholder="6"
                            value={recurringPaycheckFutureCount}
                            onChange={(e) =>
                              setRecurringPaycheckFutureCount(e.target.value)
                            }
                            className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder:text-slate-600 transition focus:border-emerald-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                          />
                        </div>
                      </>
                    )}

                    <button
                      type="submit"
                      className="w-full rounded-xl border border-emerald-500/40 bg-emerald-600/20 py-3.5 text-sm font-semibold text-emerald-300 transition hover:border-emerald-500/60 hover:bg-emerald-600/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 active:bg-emerald-600/40"
                    >
                      {paycheckFormType === "manual"
                        ? editingPaycheckId
                          ? "Save Paycheck"
                          : labels.addPaycheck
                        : editingRecurringPaycheckId
                          ? "Save Recurring Paycheck"
                          : "Add Recurring Paycheck"}
                    </button>
                  </form>

                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-slate-300">
                      Upcoming Paychecks
                    </h3>
                    {plannedPaychecks.length > 0 ? (
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
                                  className={`${TOUCH_TARGET_BUTTON_CLASS} border-white/10 text-slate-400 transition hover:border-red-500/40 hover:text-red-300`}
                                  aria-label={`Remove ${paycheck.name}`}
                                >
                                  Delete
                                </button>
                              </div>
                            </li>
                          ))}
                      </ul>
                    ) : (
                      <p className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-slate-400">
                        No upcoming paychecks yet. Add manual paychecks above
                        or set up a recurring schedule.
                      </p>
                    )}
                  </div>

                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-slate-300">
                      Active Recurring Paychecks
                    </h3>
                    {recurringPaychecks.length > 0 ? (
                      <ul className="space-y-2">
                        {recurringPaychecks.map((paycheck) => (
                          <li
                            key={paycheck.id}
                            className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-white">
                                {paycheck.name}
                              </p>
                              <p className="text-xs text-slate-500">
                                {formatRecurringPaycheckSchedule(paycheck)}
                              </p>
                            </div>
                            <span className="font-semibold tabular-nums text-emerald-200">
                              ${paycheck.amount}
                            </span>
                            <div className="flex shrink-0 gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  startEditRecurringPaycheck(paycheck)
                                }
                                className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400 transition hover:border-emerald-500/40 hover:text-emerald-300"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  removeRecurringPaycheck(paycheck.id)
                                }
                                className={`${TOUCH_TARGET_BUTTON_CLASS} border-white/10 text-slate-400 transition hover:border-red-500/40 hover:text-red-300`}
                                aria-label={`Remove ${paycheck.name}`}
                              >
                                Delete
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-slate-400">
                        No recurring paychecks yet. Add a biweekly or monthly
                        schedule above.
                      </p>
                    )}
                  </div>
                </div>
              </CollapsibleSection>

              <CollapsibleSection
                id="monthly-spending-plan"
                title={labels.monthlySpendingPlan}
                subtitle="Track spending by category"
                iconClassName="bg-violet-600/20 text-violet-400"
                isOpen={sectionOpen.monthlySpendingPlan}
                onToggle={() => toggleSection("monthlySpendingPlan")}
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
                    <path d="M3 3v18h18" />
                    <path d="M7 16l4-5 4 3 5-7" />
                  </svg>
                }
              >
                <div className="space-y-6">
                  <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-4">
                      <dt className="text-xs font-medium uppercase tracking-wide text-violet-300 sm:text-sm">
                        Total Monthly Budget
                      </dt>
                      <dd className="mt-2 text-xl font-bold tabular-nums text-white sm:text-2xl">
                        ${totalSpendingBudget.toLocaleString()}
                      </dd>
                      <dd className="mt-1 text-xs text-slate-500">
                        Across all categories
                      </dd>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400 sm:text-sm">
                        Total Spent
                      </dt>
                      <dd className="mt-2 text-xl font-bold tabular-nums text-violet-200 sm:text-2xl">
                        ${totalSpendingSpent.toLocaleString()}
                      </dd>
                      <dd className="mt-1 text-xs text-slate-500">
                        Recorded this month
                      </dd>
                    </div>
                    <div
                      className={`rounded-xl border px-4 py-4 ${
                        totalSpendingRemaining >= 0
                          ? "border-emerald-500/20 bg-emerald-500/5"
                          : "border-red-500/20 bg-red-500/5"
                      }`}
                    >
                      <dt
                        className={`text-xs font-medium uppercase tracking-wide sm:text-sm ${
                          totalSpendingRemaining >= 0
                            ? "text-emerald-300"
                            : "text-red-300"
                        }`}
                      >
                        Total Remaining
                      </dt>
                      <dd
                        className={`mt-2 text-xl font-bold tabular-nums sm:text-2xl ${
                          totalSpendingRemaining >= 0
                            ? "text-emerald-200"
                            : "text-red-300"
                        }`}
                      >
                        ${Math.max(0, totalSpendingRemaining).toLocaleString()}
                      </dd>
                      <dd className="mt-1 text-xs text-slate-500">
                        Budget minus spent
                      </dd>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400 sm:text-sm">
                        Active Categories
                      </dt>
                      <dd className="mt-2 text-xl font-bold tabular-nums text-white sm:text-2xl">
                        {activeSpendingCategoryCount}
                      </dd>
                      <dd className="mt-1 text-xs text-slate-500">
                        With a budget or spending
                      </dd>
                    </div>
                  </dl>

                  {spendingCategories.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-8 text-center sm:px-6">
                      <p className="text-base font-semibold text-white">
                        No spending categories yet.
                      </p>
                      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-400">
                        Create categories like Food, Gas, Shopping,
                        Entertainment, or Subscriptions to track your monthly
                        spending.
                      </p>
                      <button
                        type="button"
                        onClick={focusSpendingCategoryForm}
                        className="mt-5 rounded-xl border border-violet-500/40 bg-violet-600/20 px-6 py-3 text-sm font-semibold text-violet-300 transition hover:border-violet-500/60 hover:bg-violet-600/30 focus:outline-none focus:ring-2 focus:ring-violet-500/20 active:bg-violet-600/40"
                      >
                        Add First Category
                      </button>
                    </div>
                  ) : null}

                  <form
                    ref={spendingCategoryFormRef}
                    className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveSpendingCategory();
                    }}
                  >
                    <h3 className="text-sm font-semibold text-slate-300">
                      {editingSpendingCategoryId
                        ? "Edit Category"
                        : labels.addCategory}
                    </h3>
                    <div>
                      <label
                        htmlFor="spending-category-name"
                        className="mb-2 block text-sm font-medium text-slate-300"
                      >
                        Category Name
                      </label>
                      <input
                        id="spending-category-name"
                        type="text"
                        placeholder="Example: Food"
                        value={spendingCategoryName}
                        onChange={(e) => setSpendingCategoryName(e.target.value)}
                        className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder:text-slate-600 transition focus:border-violet-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="spending-category-budget"
                        className="mb-2 block text-sm font-medium text-slate-300"
                      >
                        Monthly Budget
                      </label>
                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-500">
                          $
                        </span>
                        <input
                          id="spending-category-budget"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={spendingCategoryBudget}
                          onChange={(e) =>
                            setSpendingCategoryBudget(e.target.value)
                          }
                          className="block w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-9 pr-4 text-white placeholder:text-slate-600 transition focus:border-violet-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full rounded-xl border border-violet-500/40 bg-violet-600/20 py-3.5 text-sm font-semibold text-violet-300 transition hover:border-violet-500/60 hover:bg-violet-600/30 focus:outline-none focus:ring-2 focus:ring-violet-500/20 active:bg-violet-600/40"
                    >
                      {editingSpendingCategoryId
                        ? "Save Category"
                        : labels.addCategory}
                    </button>
                  </form>

                  {spendingCategories.length > 0 ? (
                    <div className="space-y-4">
                      <h3 className="text-sm font-semibold text-slate-300">
                        Your Categories
                      </h3>
                      {visibleSpendingCategories.length === 0 ? (
                        <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-slate-400">
                          Categories appear here once you set a budget or add
                          spending.
                        </p>
                      ) : null}
                      {visibleSpendingCategories.map((category) => {
                        const amountSpent = getCategoryAmountSpent(category);
                        const amountRemaining =
                          getCategoryAmountRemaining(category);
                        const percentUsed = getCategoryPercentUsed(category);
                        const progressBarWidth = getSpendingProgressBarWidth(
                          amountSpent,
                          category.monthlyBudget,
                        );
                        const categoryStatus =
                          getSpendingCategoryStatus(percentUsed);
                        const statusStyles =
                          spendingCategoryStatusStyles[categoryStatus];
                        const transactionDraft =
                          getSpendingTransactionDraft(category.id);
                        const isExpanded = isSpendingCategoryExpanded(category);
                        const isTransactionFormOpen =
                          spendingTransactionFormOpen[category.id] === true;

                        return (
                          <div
                            key={category.id}
                            className={`rounded-xl border bg-white/[0.03] p-4 sm:p-5 ${statusStyles.cardBorder}`}
                          >
                            <div className="flex items-start gap-3">
                              <button
                                type="button"
                                onClick={() =>
                                  toggleSpendingCategoryExpanded(category)
                                }
                                className="min-w-0 flex-1 text-left"
                                aria-expanded={isExpanded}
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                                      isExpanded ? "rotate-0" : "-rotate-90"
                                    }`}
                                    aria-hidden="true"
                                  >
                                    <path d="M6 9l6 6 6-6" />
                                  </svg>
                                  <h4 className="font-semibold text-white">
                                    {category.name}
                                  </h4>
                                  <span
                                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles.badge} ${statusStyles.badgeText}`}
                                  >
                                    {categoryStatus}
                                  </span>
                                </div>
                                <p className="mt-2 text-sm font-semibold tabular-nums text-slate-200">
                                  ${amountSpent.toLocaleString()} / $
                                  {category.monthlyBudget.toLocaleString()}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {percentUsed}% Used
                                </p>
                                <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                                  <div
                                    className={`h-full rounded-full transition-all ${getSpendingProgressBarColor(percentUsed)}`}
                                    style={{ width: `${progressBarWidth}%` }}
                                  />
                                </div>
                              </button>

                              <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-start">
                                <button
                                  type="button"
                                  onClick={() =>
                                    openSpendingTransactionForm(category)
                                  }
                                  className="rounded-lg border border-violet-500/30 bg-violet-600/15 px-2.5 py-1.5 text-xs font-medium text-violet-300 transition hover:border-violet-500/50 hover:bg-violet-600/25"
                                >
                                  Add Transaction
                                </button>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      startEditSpendingCategory(category)
                                    }
                                    className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400 transition hover:border-violet-500/40 hover:text-violet-300"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      removeSpendingCategory(category.id)
                                    }
                                    className={`${TOUCH_TARGET_BUTTON_CLASS} border-white/10 text-slate-400 transition hover:border-red-500/40 hover:text-red-300`}
                                    aria-label={`Remove ${category.name}`}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            </div>

                            {isExpanded ? (
                              <div className="mt-4 border-t border-white/10 pt-4">
                                <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                                  <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
                                    <dt className="text-xs text-slate-500">
                                      Budget
                                    </dt>
                                    <dd className="mt-1 text-sm font-semibold tabular-nums text-white">
                                      $
                                      {category.monthlyBudget.toLocaleString()}
                                    </dd>
                                  </div>
                                  <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
                                    <dt className="text-xs text-slate-500">
                                      Spent
                                    </dt>
                                    <dd className="mt-1 text-sm font-semibold tabular-nums text-violet-200">
                                      ${amountSpent.toLocaleString()}
                                    </dd>
                                  </div>
                                  <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
                                    <dt className="text-xs text-slate-500">
                                      Remaining
                                    </dt>
                                    <dd
                                      className={`mt-1 text-sm font-semibold tabular-nums ${
                                        amountRemaining < 0
                                          ? "text-red-300"
                                          : "text-emerald-200"
                                      }`}
                                    >
                                      $
                                      {Math.max(
                                        0,
                                        amountRemaining,
                                      ).toLocaleString()}
                                    </dd>
                                  </div>
                                  <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
                                    <dt className="text-xs text-slate-500">
                                      Percent Used
                                    </dt>
                                    <dd className="mt-1 text-sm font-semibold tabular-nums text-white">
                                      {percentUsed}%
                                    </dd>
                                  </div>
                                </dl>

                                <h5 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                                  Transactions
                                </h5>
                                {category.transactions.length > 0 ? (
                                  <ul className="mb-4 divide-y divide-white/10 rounded-lg border border-white/10 bg-white/[0.02]">
                                    {category.transactions.map((transaction) => (
                                      <li
                                        key={transaction.id}
                                        className="flex items-center justify-between gap-3 px-3 py-3 text-sm sm:px-4"
                                      >
                                        <span className="min-w-0 flex-1 truncate font-medium text-slate-200">
                                          {transaction.name}
                                        </span>
                                        <span className="shrink-0 font-semibold tabular-nums text-violet-200">
                                          $
                                          {transaction.amount.toLocaleString()}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            removeSpendingTransaction(
                                              category.id,
                                              transaction.id,
                                            )
                                          }
                                          className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400 transition hover:border-red-500/40 hover:text-red-300"
                                          aria-label={`Remove ${transaction.name}`}
                                        >
                                          Delete
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="mb-4 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-3 text-xs text-slate-500">
                                    No transactions yet.
                                  </p>
                                )}

                                {isTransactionFormOpen ? (
                                  <form
                                    className="space-y-2"
                                    onSubmit={(e) => {
                                      e.preventDefault();
                                      addSpendingTransaction(category.id);
                                    }}
                                  >
                                    <p className="text-xs font-medium text-slate-400">
                                      Add Transaction
                                    </p>
                                    <div className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
                                      <input
                                        id={`spending-transaction-name-${category.id}`}
                                        type="text"
                                        placeholder="Store or description"
                                        value={transactionDraft.name}
                                        onChange={(e) =>
                                          updateSpendingTransactionDraft(
                                            category.id,
                                            "name",
                                            e.target.value,
                                          )
                                        }
                                        className="block w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 transition focus:border-violet-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                                      />
                                      <div className="relative">
                                        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-slate-500">
                                          $
                                        </span>
                                        <input
                                          type="number"
                                          min="0"
                                          step="0.01"
                                          placeholder="0.00"
                                          value={transactionDraft.amount}
                                          onChange={(e) =>
                                            updateSpendingTransactionDraft(
                                              category.id,
                                              "amount",
                                              e.target.value,
                                            )
                                          }
                                          className="block w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-7 pr-3 text-sm text-white placeholder:text-slate-600 transition focus:border-violet-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                                        />
                                      </div>
                                      <button
                                        type="submit"
                                        className="rounded-xl border border-violet-500/40 bg-violet-600/20 px-4 py-2.5 text-sm font-semibold text-violet-300 transition hover:border-violet-500/60 hover:bg-violet-600/30 focus:outline-none focus:ring-2 focus:ring-violet-500/20 active:bg-violet-600/40"
                                      >
                                        Add
                                      </button>
                                    </div>
                                  </form>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </CollapsibleSection>

              <CollapsibleSection
                id="cash-flow-timeline"
                title={labels.cashFlowTimeline}
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
                <p className="mb-5 text-sm leading-relaxed text-slate-400">
                  Your checking balance, bills, and paychecks build this
                  projection. Add manual events below for one-off income or
                  expenses.
                </p>
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
                      Clear Manual Events
                    </button>
                  </div>
                </form>

                {!cashFlowProjection ? (
                  <div className="mt-5 rounded-xl border border-teal-500/20 bg-teal-500/5 px-4 py-5 text-sm leading-relaxed text-slate-300">
                    Enter your checking balance or add bills and paychecks to
                    see your cash flow projection.
                  </div>
                ) : null}

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
                      <>
                        <dl className="grid gap-3 sm:grid-cols-3">
                          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm">
                            <dt className="text-emerald-400">Available Cash</dt>
                            <dd className="mt-1 font-bold tabular-nums text-emerald-300">
                              ${timelineAvailableCash.toLocaleString()}
                            </dd>
                            <dd className="mt-1 text-xs text-slate-500">
                              Starting balance + total income
                            </dd>
                          </div>
                          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm">
                            <dt className="text-red-400">Total Expenses</dt>
                            <dd className="mt-1 font-bold tabular-nums text-red-300">
                              ${timelineTotals.expenses.toLocaleString()}
                            </dd>
                            <dd className="mt-1 text-xs text-slate-500">
                              Bills and expense events only
                            </dd>
                          </div>
                          <div
                            className={`rounded-lg border px-4 py-3 text-sm ${
                              timelineRemainingCash >= 0
                                ? "border-emerald-500/20 bg-emerald-500/5"
                                : "border-red-500/20 bg-red-500/5"
                            }`}
                          >
                            <dt
                              className={
                                timelineRemainingCash >= 0
                                  ? "text-emerald-400"
                                  : "text-red-400"
                              }
                            >
                              Remaining Cash
                            </dt>
                            <dd
                              className={`mt-1 font-bold tabular-nums ${
                                timelineRemainingCash >= 0
                                  ? "text-emerald-300"
                                  : "text-red-300"
                              }`}
                            >
                              ${timelineRemainingCash.toLocaleString()}
                            </dd>
                            <dd className="mt-1 text-xs text-slate-500">
                              Equals ending projected balance
                            </dd>
                          </div>
                        </dl>

                        <div className="rounded-xl border border-teal-500/20 bg-teal-500/5 px-4 py-4 sm:px-5 sm:py-5">
                          <p className="text-xs font-semibold uppercase tracking-wide text-teal-300">
                            Projected Balance Formula
                          </p>
                          <dl className="mt-3 space-y-2 text-sm">
                            <div className="flex items-center justify-between gap-4">
                              <dt className="text-slate-400">Starting Balance</dt>
                              <dd className="font-semibold tabular-nums text-white">
                                ${cashFlowProjection.startingBalance.toLocaleString()}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <dt className="text-emerald-400">+ Total Income</dt>
                              <dd className="font-semibold tabular-nums text-emerald-300">
                                + ${timelineTotals.income.toLocaleString()}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-2">
                              <dt className="font-medium text-emerald-200">
                                = Available Cash
                              </dt>
                              <dd className="font-semibold tabular-nums text-emerald-300">
                                ${timelineAvailableCash.toLocaleString()}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <dt className="text-red-400">- Total Expenses</dt>
                              <dd className="font-semibold tabular-nums text-red-300">
                                - ${timelineTotals.expenses.toLocaleString()}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-2">
                              <dt className="font-medium text-slate-200">
                                = Remaining Cash
                              </dt>
                              <dd className="text-base font-bold tabular-nums text-white">
                                ${timelineRemainingCash.toLocaleString()}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      </>
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

                    {cashFlowProjection.rows.length > 0 ? (
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
                                    className={`${TOUCH_TARGET_BUTTON_CLASS} justify-self-start border-white/10 bg-white/5 font-semibold text-slate-300 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-200 sm:justify-self-end`}
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
                    ) : (
                      <p className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-5 text-center text-sm text-slate-400">
                        No upcoming events in your projection window. Add bills,
                        paychecks, or manual events to populate your timeline.
                      </p>
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
                title={labels.goalsAndPlanning}
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
                  <p className="text-sm leading-relaxed text-slate-400">
                    Your primary savings goal appears on the Dashboard and in
                    Financial Confidence Assistant purchase guidance.
                  </p>
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
                          {editingGoalId ? "Save Goal" : labels.addGoal}
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
                                className={`${TOUCH_TARGET_BUTTON_CLASS} border-white/10 bg-white/5 font-semibold text-slate-300 transition hover:border-red-500/40 hover:text-red-300`}
                                aria-label={`Delete ${formatGoalName(goal.name)}`}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-5 text-center text-sm leading-relaxed text-slate-400">
                      No savings goals yet. Add your first goal above to track
                      progress on the Dashboard and in purchase guidance.
                    </p>
                  )}

                </div>
              </CollapsibleSection>

              <CollapsibleSection
                id="financial-confidence-assistant"
                title={labels.financialConfidenceAssistant}
                subtitle={labels.knowBeforeYouBuy}
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
                  Thinking about a purchase? Describe what you&apos;re considering
                  and Financial Confidence will check it against your Safe To
                  Spend — before you buy.
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
                    Ask Financial Confidence
                  </button>
                </form>

                {!hasDashboardData ? (
                  <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-400">
                    Add a checking balance, bills, or paychecks so Financial
                    Confidence can calculate your Safe To Spend.
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

                    <div className="mt-4 space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">
                        Purchase Intelligence
                      </p>

                      <div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Purchase Impact
                        </p>
                        <dl className="mt-2 space-y-2 text-sm">
                          <div className="flex items-center justify-between gap-4">
                            <dt className="text-slate-400">Current Remaining Cash</dt>
                            <dd className="font-semibold tabular-nums text-white">
                              $
                              {spendingDecisionResult.currentRemainingCash.toLocaleString()}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <dt className="text-slate-400">After Purchase</dt>
                            <dd className="font-semibold tabular-nums text-white">
                              $
                              {spendingDecisionResult.remainingCashAfterPurchase.toLocaleString()}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <dt className="text-slate-400">Monthly Impact</dt>
                            <dd className="font-semibold tabular-nums text-red-300">
                              {formatSignedCurrency(
                                spendingDecisionResult.monthlyImpactAmount,
                              )}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <dt className="text-slate-400">Annual Impact</dt>
                            <dd className="font-semibold tabular-nums text-red-300">
                              {formatSignedCurrency(
                                spendingDecisionResult.annualImpactAmount,
                              )}
                            </dd>
                          </div>
                        </dl>
                      </div>

                      <div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Confidence Score Impact
                        </p>
                        <dl className="mt-2 space-y-2 text-sm">
                          <div className="flex items-center justify-between gap-4">
                            <dt className="text-slate-400">Current Score</dt>
                            <dd className="font-semibold tabular-nums text-white">
                              {spendingDecisionResult.confidenceScoreBefore}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <dt className="text-slate-400">After Purchase</dt>
                            <dd className="font-semibold tabular-nums text-white">
                              {spendingDecisionResult.confidenceScore}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-2">
                            <dt className="font-medium text-slate-300">Impact</dt>
                            <dd
                              className={`font-bold tabular-nums ${
                                spendingDecisionResult.confidenceScoreImpact >= 0
                                  ? "text-emerald-300"
                                  : "text-red-300"
                              }`}
                            >
                              {spendingDecisionResult.confidenceScoreImpact >= 0
                                ? "+"
                                : ""}
                              {spendingDecisionResult.confidenceScoreImpact}
                            </dd>
                          </div>
                        </dl>
                      </div>

                      {(() => {
                        const beforeRisk = getLowestBalanceRiskStyles(
                          spendingDecisionResult.lowestBalanceBeforePurchase,
                        );
                        const afterRisk = getLowestBalanceRiskStyles(
                          spendingDecisionResult.lowestBalanceAfterPurchase,
                        );

                        return (
                          <div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Lowest Balance Risk
                            </p>
                            <dl className="mt-2 space-y-2 text-sm">
                              <div
                                className={`flex items-center justify-between gap-4 rounded-lg border px-3 py-2 ${beforeRisk.border} ${beforeRisk.bg}`}
                              >
                                <dt className="text-slate-400">
                                  Lowest Balance Before Purchase
                                </dt>
                                <dd
                                  className={`font-semibold tabular-nums ${beforeRisk.value}`}
                                >
                                  $
                                  {spendingDecisionResult.lowestBalanceBeforePurchase.toLocaleString()}
                                </dd>
                              </div>
                              <div
                                className={`flex items-center justify-between gap-4 rounded-lg border px-3 py-2 ${afterRisk.border} ${afterRisk.bg}`}
                              >
                                <dt className="text-slate-400">
                                  Lowest Balance After Purchase
                                </dt>
                                <dd
                                  className={`font-semibold tabular-nums ${afterRisk.value}`}
                                >
                                  $
                                  {spendingDecisionResult.lowestBalanceAfterPurchase.toLocaleString()}
                                </dd>
                              </div>
                            </dl>
                          </div>
                        );
                      })()}

                      {(() => {
                        const cushion = getCushionMeter(
                          spendingDecisionResult.remainingCashAfterPurchase,
                        );

                        return (
                          <div
                            className={`rounded-lg border px-4 py-3 ${cushion.border} ${cushion.bg}`}
                          >
                            <div className="flex items-center justify-between gap-4">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Cushion Meter
                              </p>
                              <p className={`text-sm font-semibold ${cushion.text}`}>
                                {cushion.label}
                              </p>
                            </div>
                            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                              <div
                                className={`h-full rounded-full transition-all ${cushion.bar}`}
                                style={{ width: `${cushion.progressPercent}%` }}
                              />
                            </div>
                            <p className="mt-2 text-xs text-slate-400">
                              Based on remaining cash after purchase ($
                              {spendingDecisionResult.remainingCashAfterPurchase.toLocaleString()}
                              )
                            </p>
                          </div>
                        );
                      })()}
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

                      <div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {labels.safeToSpend}
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
                "Stored locally on your device. Never sent to a server or shared with anyone.",
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
            ) : profileModal === "profile" ? (
              <>
                <h2
                  id="profile-modal-title"
                  className="text-lg font-semibold text-white"
                >
                  Profile
                </h2>
                {authUser ? (
                  <>
                    <p className="mt-1 text-sm text-slate-500">
                      Your account identity is managed securely with Supabase.
                    </p>
                    <dl className="mt-5 space-y-4">
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Name
                        </dt>
                        <dd className="mt-1 text-sm font-medium text-white">
                          {getUserDisplayName(authUser) || "—"}
                        </dd>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Email
                        </dt>
                        <dd className="mt-1 text-sm font-medium text-white">
                          {authUser.email ?? "—"}
                        </dd>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Language Preference
                        </dt>
                        <dd className="mt-1 text-sm font-medium text-white">
                          {getLanguageLabel(language)}
                        </dd>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Account Created
                        </dt>
                        <dd className="mt-1 text-sm font-medium text-white">
                          {formatAccountCreatedDate(authUser.created_at)}
                        </dd>
                      </div>
                    </dl>
                  </>
                ) : !isSupabaseConfigured() ? (
                  <>
                    <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200">
                      Authentication is not configured. Add{" "}
                      <code className="text-amber-100">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
                      and{" "}
                      <code className="text-amber-100">
                        NEXT_PUBLIC_SUPABASE_ANON_KEY
                      </code>{" "}
                      to your <code className="text-amber-100">.env.local</code> file
                      to enable Sign Up and Log In.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-3 text-sm leading-relaxed text-slate-400">
                      Sign in to view your account profile, or create a new
                      account to get started.
                    </p>
                    <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                      <Link
                        href="/login"
                        onClick={() => setProfileModal(null)}
                        className="flex-1 rounded-xl border border-cyan-500/40 bg-cyan-600/20 py-3 text-center text-sm font-semibold text-cyan-300 transition hover:border-cyan-500/60 hover:bg-cyan-600/30"
                      >
                        Log In
                      </Link>
                      <Link
                        href="/signup"
                        onClick={() => setProfileModal(null)}
                        className="flex-1 rounded-xl border border-white/10 bg-white/5 py-3 text-center text-sm font-semibold text-slate-300 transition hover:bg-white/[0.08]"
                      >
                        Sign Up
                      </Link>
                    </div>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setProfileModal(null)}
                  className="mt-5 w-full rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-semibold text-slate-300 transition hover:bg-white/[0.08]"
                >
                  Close
                </button>
              </>
            ) : profileModal === "loadSampleData" ? (
              <>
                <h2
                  id="profile-modal-title"
                  className="text-lg font-semibold text-white"
                >
                  Load Sample Data?
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-400">
                  This will replace your current app data with sample data for
                  testing.
                </p>
                <div className="mt-6 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setProfileModal(null)}
                    className="flex-1 rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-semibold text-slate-300 transition hover:bg-white/[0.08]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmLoadSampleData}
                    className="flex-1 rounded-xl border border-cyan-500/40 bg-cyan-600/20 py-3 text-sm font-semibold text-cyan-300 transition hover:border-cyan-500/60 hover:bg-cyan-600/30"
                  >
                    Load Sample Data
                  </button>
                </div>
              </>
            ) : profileModal === "language" ? (
              <>
                <h2
                  id="profile-modal-title"
                  className="text-lg font-semibold text-white"
                >
                  {labels.selectLanguage}
                </h2>
                <div className="mt-5 space-y-3">
                  <button
                    type="button"
                    onClick={() => selectLanguage("en")}
                    className={`flex w-full items-center justify-between rounded-xl border px-4 py-3.5 text-sm font-semibold transition ${
                      language === "en"
                        ? "border-cyan-500/40 bg-cyan-600/20 text-cyan-200"
                        : "border-white/10 bg-white/5 text-slate-200 hover:border-white/20 hover:bg-white/[0.08]"
                    }`}
                  >
                    <span>{APP_LABELS.en.english}</span>
                    {language === "en" ? (
                      <span className="text-xs font-medium text-cyan-300">
                        ✓
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => selectLanguage("es")}
                    className={`flex w-full items-center justify-between rounded-xl border px-4 py-3.5 text-sm font-semibold transition ${
                      language === "es"
                        ? "border-cyan-500/40 bg-cyan-600/20 text-cyan-200"
                        : "border-white/10 bg-white/5 text-slate-200 hover:border-white/20 hover:bg-white/[0.08]"
                    }`}
                  >
                    <span>{APP_LABELS.es.spanish}</span>
                    {language === "es" ? (
                      <span className="text-xs font-medium text-cyan-300">
                        ✓
                      </span>
                    ) : null}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setProfileModal(null)}
                  className="mt-5 w-full rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-semibold text-slate-300 transition hover:bg-white/[0.08]"
                >
                  Close
                </button>
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
                      Your financial data stays on this device in your browser.
                      Nothing is sent to a server or shared with anyone. Clearing
                      browser data will remove your saved information.
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
          © Financial Confidence. Built for smarter
          money decisions — stored locally on your device.
        </p>
      </footer>
    </div>
  );
}
