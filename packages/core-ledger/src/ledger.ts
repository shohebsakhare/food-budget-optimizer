import {
  BudgetCycle,
  Expense,
  ExpenseCategory,
  MealSlot,
  VarianceReport,
  SlotVariance,
  CategoryBreakdown,
  ReplanFeasibilityCheck
} from './types.js';
import { Money } from './money.js';

export class BudgetLedgerService {
  private cycles: Map<string, BudgetCycle> = new Map();
  private expenses: Map<string, Expense[]> = new Map(); // key = budgetCycleId

  /**
   * Registers a new budget cycle.
   */
  public registerBudgetCycle(cycle: BudgetCycle): void {
    Money.assertNonNegativePence(cycle.totalBudgetPence, 'totalBudgetPence');
    this.cycles.set(cycle.id, { ...cycle });
    if (!this.expenses.has(cycle.id)) {
      this.expenses.set(cycle.id, []);
    }
  }

  /**
   * Retrieves a registered budget cycle.
   */
  public getBudgetCycle(cycleId: string): BudgetCycle {
    const cycle = this.cycles.get(cycleId);
    if (!cycle) {
      throw new Error(`Budget cycle ${cycleId} not found`);
    }
    return { ...cycle };
  }

  /**
   * Records an immutable expense into the ledger.
   */
  public recordExpense(expense: Expense): Expense {
    const cycle = this.getBudgetCycle(expense.budgetCycleId);
    Money.assertNonNegativePence(expense.amountPence, 'expense.amountPence');

    const cycleExpenses = this.expenses.get(cycle.id) || [];
    const newExpense = { ...expense };
    cycleExpenses.push(newExpense);
    this.expenses.set(cycle.id, cycleExpenses);
    return newExpense;
  }

  /**
   * Returns all expenses recorded for a cycle.
   */
  public getExpensesForCycle(cycleId: string): Expense[] {
    return (this.expenses.get(cycleId) || []).map(e => ({ ...e }));
  }

  /**
   * Computes the total actual amount spent so far in integer pence.
   */
  public getTotalActualSpendPence(cycleId: string): number {
    const expenses = this.expenses.get(cycleId) || [];
    return Money.sum(expenses.map(e => e.amountPence));
  }

  /**
   * Computes remaining cash budget for the week: Total Budget - Actual Spent.
   */
  public getRemainingBudgetPence(cycleId: string): number {
    const cycle = this.getBudgetCycle(cycleId);
    const totalSpent = this.getTotalActualSpendPence(cycleId);
    return cycle.totalBudgetPence - totalSpent;
  }

  /**
   * Computes the full variance report comparing planned meal slots with actual recorded expenses.
   * Deterministically calculates:
   * - Total actual spend
   * - Remaining cash budget
   * - Projected remaining spend across upcoming planned slots
   * - Final projected spend (Actuals + Projected Remaining)
   * - Net variance (Deficit if positive, Surplus if negative)
   * - Slot-by-slot delta for matched slots
   * - Category breakdowns
   */
  public calculateVarianceReport(cycleId: string, slots: MealSlot[]): VarianceReport {
    const cycle = this.getBudgetCycle(cycleId);
    const expenses = this.getExpensesForCycle(cycleId);
    
    const totalActualSpendPence = Money.sum(expenses.map(e => e.amountPence));
    const remainingBudgetPence = cycle.totalBudgetPence - totalActualSpendPence;

    // Remaining planned slots (not yet consumed, skipped, or replaced)
    const remainingSlots = slots.filter(s => s.status === 'planned');
    const projectedRemainingSpendPence = Money.sum(remainingSlots.map(s => s.projectedCostPence));
    
    const projectedFinalSpendPence = totalActualSpendPence + projectedRemainingSpendPence;
    const netVariancePence = projectedFinalSpendPence - cycle.totalBudgetPence;
    const isProjectedOverBudget = netVariancePence > 0;

    // Map slot variances where an expense is tied to a specific slot
    const slotVariances: SlotVariance[] = [];
    const expensesBySlot = new Map<string, Expense[]>();

    for (const exp of expenses) {
      if (exp.plannedSlotId) {
        const list = expensesBySlot.get(exp.plannedSlotId) || [];
        list.push(exp);
        expensesBySlot.set(exp.plannedSlotId, list);
      }
    }

    for (const slot of slots) {
      const slotExpenses = expensesBySlot.get(slot.id) || [];
      const slotActualPence = Money.sum(slotExpenses.map(e => e.amountPence));
      
      if (slot.status === 'consumed' || slotExpenses.length > 0) {
        slotVariances.push({
          slotId: slot.id,
          date: slot.date,
          title: slot.title,
          projectedCostPence: slot.projectedCostPence,
          actualCostPence: slotActualPence,
          variancePence: slotActualPence - slot.projectedCostPence
        });
      }
    }

    // Category breakdown
    const categories: ExpenseCategory[] = ['groceries', 'takeaway', 'restaurant', 'convenience'];
    const categoryBreakdown = {} as Record<ExpenseCategory, CategoryBreakdown>;

    for (const cat of categories) {
      const catActual = Money.sum(expenses.filter(e => e.category === cat).map(e => e.amountPence));
      // Map slot channel to category
      const catProjected = Money.sum(
        slots.filter(s => {
          if (cat === 'takeaway') return s.channel === 'takeaway';
          if (cat === 'restaurant') return s.channel === 'restaurant';
          if (cat === 'convenience') return s.channel === 'convenience';
          if (cat === 'groceries') return s.channel === 'home_cook' || s.channel === 'leftover';
          return false;
        }).map(s => s.projectedCostPence)
      );

      categoryBreakdown[cat] = {
        projectedPence: catProjected,
        actualPence: catActual,
        variancePence: catActual - catProjected
      };
    }

    return {
      budgetCycleId: cycleId,
      totalBudgetPence: cycle.totalBudgetPence,
      totalActualSpendPence,
      remainingBudgetPence,
      projectedRemainingSpendPence,
      projectedFinalSpendPence,
      netVariancePence,
      isProjectedOverBudget,
      categoryBreakdown,
      slotVariances
    };
  }

  /**
   * Validates whether a candidate list of remaining slots fits within the remaining cash budget.
   */
  public evaluateReplanFeasibility(cycleId: string, candidateRemainingSlots: MealSlot[]): ReplanFeasibilityCheck {
    const remainingBudgetPence = this.getRemainingBudgetPence(cycleId);
    const requestedPence = Money.sum(candidateRemainingSlots.map(s => s.projectedCostPence));
    const deficitPence = requestedPence - remainingBudgetPence;

    return {
      isFeasible: deficitPence <= 0,
      maxAffordableRemainingPence: Math.max(0, remainingBudgetPence),
      currentRequestedRemainingPence: requestedPence,
      deficitPence: Math.max(0, deficitPence)
    };
  }
}
