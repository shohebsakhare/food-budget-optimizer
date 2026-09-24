import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BudgetLedgerService, BudgetCycle, MealSlot, Money } from '@food-budget/core-ledger';
import { FoodBudgetOrchestrator } from './agent-state-machine.js';

describe('AI Orchestrator & Conversational Rebalance Flow', () => {
  it('executes complete conversational lifecycle: £25 vs £18 on Wednesday and replans rest of week', async () => {
    const ledger = new BudgetLedgerService();

    // 1. Initial Weekly Budget: £120.00
    const cycle: BudgetCycle = {
      id: 'cycle-week-1',
      householdId: 'household-shohei',
      startDate: '2026-09-21',
      endDate: '2026-09-27',
      totalBudgetPence: Money.fromDecimal(120.00),
      targets: {
        groceriesTargetPence: 6000,
        takeawayTargetPence: 2000,
        restaurantTargetPence: 3500,
        bufferPence: 500
      },
      status: 'active'
    };
    ledger.registerBudgetCycle(cycle);

    // 2. Initial Meal Plan (7 Slots)
    const slots: MealSlot[] = [
      { id: 'mon', date: '2026-09-21', slotType: 'dinner', channel: 'home_cook', title: 'Cook chicken curry', projectedCostPence: 500, status: 'planned' },
      { id: 'tue', date: '2026-09-22', slotType: 'dinner', channel: 'home_cook', title: 'Cook pasta', projectedCostPence: 400, status: 'planned' },
      { id: 'wed', date: '2026-09-23', slotType: 'dinner', channel: 'takeaway', title: 'Takeaway', projectedCostPence: 1800, status: 'planned' },
      { id: 'thu', date: '2026-09-24', slotType: 'dinner', channel: 'leftover', title: 'Leftovers', projectedCostPence: 200, status: 'planned' },
      { id: 'fri', date: '2026-09-25', slotType: 'dinner', channel: 'restaurant', title: 'Restaurant', projectedCostPence: 3000, status: 'planned' },
      { id: 'sat', date: '2026-09-26', slotType: 'dinner', channel: 'home_cook', title: 'Cook burgers', projectedCostPence: 800, status: 'planned' },
      { id: 'sun', date: '2026-09-27', slotType: 'dinner', channel: 'home_cook', title: 'Cook stir fry', projectedCostPence: 600, status: 'planned' }
    ];

    // Initial assertions:
    // Projected spend: £73, Remaining: £47
    const projectedSpend = Money.sum(slots.map(s => s.projectedCostPence));
    assert.equal(projectedSpend, 7300);
    assert.equal(Money.format(projectedSpend), '£73.00');

    const remainingCash = cycle.totalBudgetPence - projectedSpend;
    assert.equal(remainingCash, 4700);
    assert.equal(Money.format(remainingCash), '£47.00');

    // Simulate Mon and Tue spent normally
    slots[0].status = 'consumed';
    ledger.recordExpense({ id: 'e1', budgetCycleId: cycle.id, householdId: 'h1', category: 'groceries', amountPence: 500, description: 'Mon curry', incurredAt: new Date() });
    slots[1].status = 'consumed';
    ledger.recordExpense({ id: 'e2', budgetCycleId: cycle.id, householdId: 'h1', category: 'groceries', amountPence: 400, description: 'Tue pasta', incurredAt: new Date() });

    // 3. User says: "I spent £25 instead of £18 on Wednesday takeaway."
    const orchestrator = new FoodBudgetOrchestrator(ledger, slots);

    const response = await orchestrator.handleUserExpenseStatement(
      cycle.id,
      "I spent £25 instead of £18 on Wednesday takeaway."
    );

    // 4. Assert Orchestrator Response correctness
    assert.equal(response.hasVariance, true);
    assert.equal(response.variancePence, 700); // +£7.00
    assert.equal(response.remainingBudgetFormatted, '£86.00'); // £120 - (£5 + £4 + £25) = £86.00

    assert.ok(response.optionsCard);
    assert.equal(response.optionsCard.options.length, 2);

    // Option 1: Swap Friday Restaurant (£30.00) -> Home Cook (£5.00), saving £25.00
    const option1 = response.optionsCard.options[0];
    assert.equal(option1.strategyCode, 'CHANNEL_DOWNGRADE');
    assert.equal(option1.savingsFormatted, '£25.00');

    // Option 2: Batch leftover for weekend, saving £6.00
    const option2 = response.optionsCard.options[1];
    assert.equal(option2.strategyCode, 'BATCH_LEFTOVER');
    assert.equal(option2.savingsFormatted, '£6.00');

    // 5. User selects Option 1 (Swap Friday restaurant to gourmet home cooking)
    const updatedSlots = orchestrator.applyRebalanceOption('CHANNEL_DOWNGRADE');
    const fridaySlot = updatedSlots.find(s => s.id === 'fri');
    assert.ok(fridaySlot);
    assert.equal(fridaySlot.channel, 'home_cook');
    assert.equal(fridaySlot.projectedCostPence, 500); // Now £5.00 instead of £30.00

    // 6. Verify full week rebalanced feasibility
    const remainingSlots = updatedSlots.filter(s => s.status === 'planned');
    // Thu: Leftovers (£2) + Fri: Home cook (£5) + Sat: Burgers (£8) + Sun: Stir fry (£6) = £21.00
    const newRemainingProjected = Money.sum(remainingSlots.map(s => s.projectedCostPence));
    assert.equal(newRemainingProjected, 2100);
    assert.equal(Money.format(newRemainingProjected), '£21.00');

    // Total actual (£34) + Total new projected (£21) = £55.00, well within £120.00 budget!
    const totalSpentSoFar = ledger.getTotalActualSpendPence(cycle.id);
    assert.equal(totalSpentSoFar, 3400);

    const projectedFinal = totalSpentSoFar + newRemainingProjected;
    assert.equal(projectedFinal, 5500); // £55.00 total spend
    assert.ok(projectedFinal <= cycle.totalBudgetPence);
  });
});
