import {
  BudgetLedgerService,
  MealSlot,
  Money,
  VarianceReport,
  Expense
} from '@food-budget/core-ledger';
import { LogExpenseParams, RequestReplanParams } from './agent-tools.js';

export interface AgentResponse {
  messageText: string;
  hasVariance: boolean;
  variancePence: number;
  remainingBudgetFormatted: string;
  optionsCard?: {
    title: string;
    description: string;
    options: Array<{
      strategyCode: string;
      title: string;
      description: string;
      savingsFormatted: string;
      newTotalFormatted: string;
      isFeasible: boolean;
    }>;
  };
}

export class FoodBudgetOrchestrator {
  constructor(
    private ledger: BudgetLedgerService,
    private activeSlots: MealSlot[]
  ) {}

  /**
   * Processes a natural language statement from the user regarding spending or plan adjustments.
   * Extracts structured parameters, queries the deterministic ledger, and synthesizes
   * verified responses with interactive option cards.
   */
  public async handleUserExpenseStatement(
    budgetCycleId: string,
    rawText: string
  ): Promise<AgentResponse> {
    // 1. Structured Intent & Entity Extraction (Simulating LLM Tool-Call extraction)
    const extracted = this.extractExpenseIntent(rawText);

    if (!extracted) {
      return {
        messageText: "I couldn't detect an expense in your message. You can say things like 'I spent £25 instead of £18 on Wednesday takeaway.'",
        hasVariance: false,
        variancePence: 0,
        remainingBudgetFormatted: Money.format(this.ledger.getRemainingBudgetPence(budgetCycleId))
      };
    }

    // 2. Find associated meal slot
    const targetSlot = this.activeSlots.find(
      s => s.id.toLowerCase() === extracted.day.toLowerCase() ||
           s.title.toLowerCase().includes(extracted.day.toLowerCase())
    );

    // 3. Deterministically record expense into the ledger
    const expense: Expense = {
      id: `exp-${Date.now()}`,
      budgetCycleId,
      householdId: 'household-default',
      category: extracted.category,
      amountPence: extracted.amountPence,
      plannedSlotId: targetSlot?.id,
      description: targetSlot ? `Actual spend for ${targetSlot.title}` : `Ad-hoc food expense`,
      incurredAt: new Date()
    };
    this.ledger.recordExpense(expense);

    if (targetSlot) {
      targetSlot.status = 'consumed';
      targetSlot.actualCostPence = extracted.amountPence;
    }

    // 4. Compute deterministic variance report from ledger
    const report: VarianceReport = this.ledger.calculateVarianceReport(budgetCycleId, this.activeSlots);

    const slotVariance = targetSlot
      ? (targetSlot.actualCostPence || 0) - targetSlot.projectedCostPence
      : 0;

    const remainingCash = report.remainingBudgetPence;
    const remainingCashFormatted = Money.format(remainingCash);

    // 5. Generate Rebalance Options if variance is positive (over budget on that slot)
    const optionsCard = this.generateRebalanceCards(budgetCycleId, slotVariance);

    const varianceSign = slotVariance > 0 ? '+' : '';
    const varianceDesc = slotVariance !== 0
      ? ` (${varianceSign}${Money.format(slotVariance)} vs planned ${targetSlot ? Money.format(targetSlot.projectedCostPence) : '£0'})`
      : '';

    const message = `Recorded your ${extracted.category} expense of ${Money.format(extracted.amountPence)}${varianceDesc}. ` +
      `You have ${remainingCashFormatted} remaining in your total weekly budget.`;

    return {
      messageText: message,
      hasVariance: slotVariance !== 0,
      variancePence: slotVariance,
      remainingBudgetFormatted: remainingCashFormatted,
      optionsCard
    };
  }

  /**
   * Deterministic intent extractor for conversational inputs.
   */
  private extractExpenseIntent(text: string): {
    amountPence: number;
    category: 'groceries' | 'takeaway' | 'restaurant' | 'convenience';
    day: string;
  } | null {
    // Matches patterns like "spent £25 instead of £18 on Wednesday" or "spent 25 on wednesday takeaway"
    const amountMatch = text.match(/spent\s+[£$]?(\d+(?:\.\d{2})?)/i);
    if (!amountMatch) return null;

    const amount = parseFloat(amountMatch[1]);
    const amountPence = Money.fromDecimal(amount);

    let category: 'groceries' | 'takeaway' | 'restaurant' | 'convenience' = 'groceries';
    const lower = text.toLowerCase();
    if (lower.includes('takeaway') || lower.includes('delivery')) category = 'takeaway';
    else if (lower.includes('restaurant') || lower.includes('eat out') || lower.includes('eating out')) category = 'restaurant';
    else if (lower.includes('convenience') || lower.includes('snack')) category = 'convenience';

    let day = 'wed';
    if (lower.includes('monday')) day = 'mon';
    else if (lower.includes('tuesday')) day = 'tue';
    else if (lower.includes('wednesday') || lower.includes('wed')) day = 'wed';
    else if (lower.includes('thursday') || lower.includes('thu')) day = 'thu';
    else if (lower.includes('friday') || lower.includes('fri')) day = 'fri';
    else if (lower.includes('saturday') || lower.includes('sat')) day = 'sat';
    else if (lower.includes('sunday') || lower.includes('sun')) day = 'sun';

    return { amountPence, category, day };
  }

  /**
   * Generates deterministic rebalancing recommendations.
   */
  private generateRebalanceCards(budgetCycleId: string, overspendPence: number) {
    if (overspendPence <= 0) return undefined;

    const upcomingSlots = this.activeSlots.filter(s => s.status === 'planned');
    const diningSlot = upcomingSlots.find(s => s.channel === 'restaurant' || s.channel === 'takeaway');
    const homeCookSlots = upcomingSlots.filter(s => s.channel === 'home_cook');

    const options = [];

    // Option 1: Channel downgrade if restaurant exists
    if (diningSlot) {
      const cookAlternativePence = 500; // £5.00 home cooked curry
      const savingsPence = diningSlot.projectedCostPence - cookAlternativePence;
      const currentRemainingTotal = Money.sum(upcomingSlots.map(s => s.projectedCostPence));
      const newTotal = currentRemainingTotal - savingsPence;

      options.push({
        strategyCode: 'CHANNEL_DOWNGRADE',
        title: `Swap ${diningSlot.title} to Gourmet Home Cooking`,
        description: `Replace ${diningSlot.title} on ${diningSlot.date} with a delicious home-cooked meal (${Money.format(cookAlternativePence)}).`,
        savingsFormatted: Money.format(savingsPence),
        newTotalFormatted: Money.format(newTotal),
        isFeasible: true
      });
    }

    // Option 2: Batch leftover synergy
    if (homeCookSlots.length >= 2) {
      const s1 = homeCookSlots[0];
      const s2 = homeCookSlots[1];
      const savingsPence = s2.projectedCostPence;
      const currentRemainingTotal = Money.sum(upcomingSlots.map(s => s.projectedCostPence));
      const newTotal = currentRemainingTotal - savingsPence;

      options.push({
        strategyCode: 'BATCH_LEFTOVER',
        title: 'Batch Cooking & Leftover Synergy',
        description: `Double batch on ${s1.date} and enjoy free leftovers on ${s2.date} instead of cooking a separate meal.`,
        savingsFormatted: Money.format(savingsPence),
        newTotalFormatted: Money.format(newTotal),
        isFeasible: true
      });
    }

    return {
      title: `Recommended Options to Balance Your Week`,
      description: `You spent ${Money.format(overspendPence)} more than planned. Here is how you can adjust the remaining week:`,
      options
    };
  }

  /**
   * Applies an approved rebalancing choice to the active meal plan.
   */
  public applyRebalanceOption(strategyCode: string): MealSlot[] {
    const upcoming = this.activeSlots.filter(s => s.status === 'planned');

    if (strategyCode === 'CHANNEL_DOWNGRADE') {
      const diningSlot = upcoming.find(s => s.channel === 'restaurant');
      if (diningSlot) {
        diningSlot.channel = 'home_cook';
        diningSlot.title = 'Cook Chicken Curry (Budget Rebalance)';
        diningSlot.projectedCostPence = 500;
      }
    } else if (strategyCode === 'BATCH_LEFTOVER') {
      const cookSlots = upcoming.filter(s => s.channel === 'home_cook');
      if (cookSlots.length >= 2) {
        cookSlots[1].channel = 'leftover';
        cookSlots[1].title = `Leftovers from ${cookSlots[0].title}`;
        cookSlots[1].projectedCostPence = 0;
      }
    }

    return this.activeSlots;
  }
}
