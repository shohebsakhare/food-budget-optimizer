/**
 * Types and interfaces for the Deterministic Financial Ledger
 * All monetary amounts are in minor units (pence / cents) as integers.
 */

export type ExpenseCategory = 'groceries' | 'takeaway' | 'restaurant' | 'convenience';

export type MealChannel = 'home_cook' | 'leftover' | 'takeaway' | 'restaurant' | 'convenience' | 'skip';

export type SlotStatus = 'planned' | 'consumed' | 'skipped' | 'replaced';

export interface BudgetTargets {
  groceriesTargetPence: number;
  takeawayTargetPence: number;
  restaurantTargetPence: number;
  bufferPence: number;
}

export interface BudgetCycle {
  id: string;
  householdId: string;
  startDate: string; // ISO 8601 YYYY-MM-DD
  endDate: string;   // ISO 8601 YYYY-MM-DD
  totalBudgetPence: number;
  targets: BudgetTargets;
  status: 'active' | 'closed' | 'rollover';
}

export interface Expense {
  id: string;
  budgetCycleId: string;
  householdId: string;
  category: ExpenseCategory;
  amountPence: number;
  plannedSlotId?: string;
  description: string;
  vendorName?: string;
  incurredAt: Date;
}

export interface MealSlot {
  id: string;
  date: string; // ISO 8601 YYYY-MM-DD
  slotType: 'breakfast' | 'lunch' | 'dinner';
  channel: MealChannel;
  title: string;
  recipeId?: string;
  parentSlotId?: string;
  restaurantName?: string;
  projectedCostPence: number;
  actualCostPence?: number;
  status: SlotStatus;
}

export interface SlotVariance {
  slotId: string;
  date: string;
  title: string;
  projectedCostPence: number;
  actualCostPence: number;
  variancePence: number; // Positive = overspend, Negative = underspend
}

export interface CategoryBreakdown {
  projectedPence: number;
  actualPence: number;
  variancePence: number;
}

export interface VarianceReport {
  budgetCycleId: string;
  totalBudgetPence: number;
  totalActualSpendPence: number;
  remainingBudgetPence: number;
  projectedRemainingSpendPence: number;
  projectedFinalSpendPence: number;
  netVariancePence: number; // projectedFinalSpendPence - totalBudgetPence. Positive = deficit, Negative = surplus
  isProjectedOverBudget: boolean;
  categoryBreakdown: Record<ExpenseCategory, CategoryBreakdown>;
  slotVariances: SlotVariance[];
}

export interface ReplanFeasibilityCheck {
  isFeasible: boolean;
  maxAffordableRemainingPence: number;
  currentRequestedRemainingPence: number;
  deficitPence: number; // >0 if not feasible
}
