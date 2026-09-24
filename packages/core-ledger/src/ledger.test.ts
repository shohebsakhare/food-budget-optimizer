import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Money } from './money.js';
import { BudgetLedgerService } from './ledger.js';
import { BudgetCycle, MealSlot, Expense } from './types.js';

describe('Deterministic Financial Ledger Tests', () => {

  describe('Money Arithmetic & Precision', () => {
    it('converts decimal amounts to integer pence without floating point error', () => {
      assert.equal(Money.fromDecimal(18.50), 1850);
      assert.equal(Money.fromDecimal(19.99), 1999);
      assert.equal(Money.fromDecimal(0.01), 1);
      assert.equal(Money.fromDecimal(0.00), 0);
      // Classic IEEE-754 bug: 0.1 + 0.2
      const sum = Money.fromDecimal(0.10) + Money.fromDecimal(0.20);
      assert.equal(sum, 30);
      assert.equal(Money.toDecimalString(sum), '0.30');
    });

    it('formats currency correctly in GBP', () => {
      assert.equal(Money.format(12000, 'GBP'), '£120.00');
      assert.equal(Money.format(1850, 'GBP'), '£18.50');
      assert.equal(Money.format(700, 'GBP'), '£7.00');
      assert.equal(Money.format(-700, 'GBP'), '-£7.00');
      assert.equal(Money.format(0, 'GBP'), '£0.00');
    });

    it('asserts non-negative integers strictly', () => {
      assert.doesNotThrow(() => Money.assertNonNegativePence(100));
      assert.doesNotThrow(() => Money.assertNonNegativePence(0));
      assert.throws(() => Money.assertNonNegativePence(-1), /cannot be negative/);
      assert.throws(() => Money.assertNonNegativePence(10.5), /Expected integer/);
    });
  });

  describe('Weekly Food Budget & Wednesday Variance Scenario (£120 Budget)', () => {
    it('accurately reproduces the user example and calculates the £7 overspend variance', () => {
      const ledger = new BudgetLedgerService();

      // 1. Initial Weekly Budget: £120
      const cycle: BudgetCycle = {
        id: 'cycle-week-1',
        householdId: 'household-1',
        startDate: '2026-09-21',
        endDate: '2026-09-27',
        totalBudgetPence: Money.fromDecimal(120.00), // 12000
        targets: {
          groceriesTargetPence: Money.fromDecimal(60.00),
          takeawayTargetPence: Money.fromDecimal(20.00),
          restaurantTargetPence: Money.fromDecimal(35.00),
          bufferPence: Money.fromDecimal(5.00)
        },
        status: 'active'
      };
      ledger.registerBudgetCycle(cycle);

      // 2. Initial Meal Plan Slots:
      // Mon: Cook chicken curry (£5)
      // Tue: Cook pasta (£4)
      // Wed: Takeaway (£18)
      // Thu: Leftovers (£2)
      // Fri: Restaurant (£30)
      // Sat: Cook burgers (£8)
      // Sun: Cook stir fry (£6)
      const slots: MealSlot[] = [
        { id: 'mon', date: '2026-09-21', slotType: 'dinner', channel: 'home_cook', title: 'Cook chicken curry', projectedCostPence: Money.fromDecimal(5.00), status: 'planned' },
        { id: 'tue', date: '2026-09-22', slotType: 'dinner', channel: 'home_cook', title: 'Cook pasta', projectedCostPence: Money.fromDecimal(4.00), status: 'planned' },
        { id: 'wed', date: '2026-09-23', slotType: 'dinner', channel: 'takeaway', title: 'Takeaway', projectedCostPence: Money.fromDecimal(18.00), status: 'planned' },
        { id: 'thu', date: '2026-09-24', slotType: 'dinner', channel: 'leftover', title: 'Leftovers', projectedCostPence: Money.fromDecimal(2.00), status: 'planned' },
        { id: 'fri', date: '2026-09-25', slotType: 'dinner', channel: 'restaurant', title: 'Restaurant', projectedCostPence: Money.fromDecimal(30.00), status: 'planned' },
        { id: 'sat', date: '2026-09-26', slotType: 'dinner', channel: 'home_cook', title: 'Cook burgers', projectedCostPence: Money.fromDecimal(8.00), status: 'planned' },
        { id: 'sun', date: '2026-09-27', slotType: 'dinner', channel: 'home_cook', title: 'Cook stir fry', projectedCostPence: Money.fromDecimal(6.00), status: 'planned' }
      ];

      // Initial validation: Projected spend = £73, Remaining = £47
      const initialProjected = Money.sum(slots.map(s => s.projectedCostPence));
      assert.equal(initialProjected, 7300); // £73.00
      assert.equal(Money.format(initialProjected), '£73.00');

      const initialRemaining = cycle.totalBudgetPence - initialProjected;
      assert.equal(initialRemaining, 4700); // £47.00
      assert.equal(Money.format(initialRemaining), '£47.00');

      // 3. User consumes Monday and Tuesday exactly as planned
      slots[0].status = 'consumed';
      ledger.recordExpense({
        id: 'exp-mon',
        budgetCycleId: cycle.id,
        householdId: cycle.householdId,
        category: 'groceries',
        amountPence: Money.fromDecimal(5.00),
        plannedSlotId: 'mon',
        description: 'Chicken curry ingredients',
        incurredAt: new Date('2026-09-21T19:00:00Z')
      });

      slots[1].status = 'consumed';
      ledger.recordExpense({
        id: 'exp-tue',
        budgetCycleId: cycle.id,
        householdId: cycle.householdId,
        category: 'groceries',
        amountPence: Money.fromDecimal(4.00),
        plannedSlotId: 'tue',
        description: 'Pasta ingredients',
        incurredAt: new Date('2026-09-22T19:00:00Z')
      });

      // 4. Wednesday: User says: "I spent £25 instead of £18 on Wednesday."
      slots[2].status = 'consumed';
      const wedExpense: Expense = {
        id: 'exp-wed',
        budgetCycleId: cycle.id,
        householdId: cycle.householdId,
        category: 'takeaway',
        amountPence: Money.fromDecimal(25.00), // £25.00 actual
        plannedSlotId: 'wed',
        description: 'Wednesday takeaway actual',
        vendorName: 'Local Thai Place',
        incurredAt: new Date('2026-09-23T20:00:00Z')
      };
      ledger.recordExpense(wedExpense);

      // 5. Generate Variance Report
      const report = ledger.calculateVarianceReport(cycle.id, slots);

      // Verify total spent so far: £5 + £4 + £25 = £34.00
      assert.equal(report.totalActualSpendPence, 3400);
      assert.equal(Money.format(report.totalActualSpendPence), '£34.00');

      // Verify remaining cash budget: £120 - £34 = £86.00
      assert.equal(report.remainingBudgetPence, 8600);
      assert.equal(Money.format(report.remainingBudgetPence), '£86.00');

      // Verify remaining planned slots (Thu-Sun): £2 + £30 + £8 + £6 = £46.00
      assert.equal(report.projectedRemainingSpendPence, 4600);
      assert.equal(Money.format(report.projectedRemainingSpendPence), '£46.00');

      // Projected final spend: £34 + £46 = £80.00
      assert.equal(report.projectedFinalSpendPence, 8000);
      assert.equal(Money.format(report.projectedFinalSpendPence), '£80.00');

      // Invariant: Remaining cash (£86) - Remaining planned (£46) = Surplus of £40
      const remainingUnallocated = report.remainingBudgetPence - report.projectedRemainingSpendPence;
      assert.equal(remainingUnallocated, 4000); // £40.00 unallocated buffer remaining

      // Verify Wednesday slot variance: £25.00 actual vs £18.00 planned = +£7.00
      const wedVariance = report.slotVariances.find(v => v.slotId === 'wed');
      assert.ok(wedVariance);
      assert.equal(wedVariance.variancePence, 700); // +£7.00 overspend
      assert.equal(Money.format(wedVariance.variancePence), '£7.00');

      // Verify Feasibility for upcoming slots: Thu-Sun (£46) is feasible within £86 remaining
      const upcomingSlots = slots.filter(s => s.status === 'planned');
      const feasibility = ledger.evaluateReplanFeasibility(cycle.id, upcomingSlots);
      assert.equal(feasibility.isFeasible, true);
      assert.equal(feasibility.maxAffordableRemainingPence, 8600);
      assert.equal(feasibility.deficitPence, 0);
    });

    it('correctly detects deficit when variance exceeds remaining budget (Tight Budget Case)', () => {
      const ledger = new BudgetLedgerService();

      // Tight Budget: £75 Total
      const tightCycle: BudgetCycle = {
        id: 'tight-cycle',
        householdId: 'household-2',
        startDate: '2026-09-21',
        endDate: '2026-09-27',
        totalBudgetPence: Money.fromDecimal(75.00), // £75.00
        targets: {
          groceriesTargetPence: Money.fromDecimal(40.00),
          takeawayTargetPence: Money.fromDecimal(18.00),
          restaurantTargetPence: Money.fromDecimal(17.00),
          bufferPence: 0
        },
        status: 'active'
      };
      ledger.registerBudgetCycle(tightCycle);

      const slots: MealSlot[] = [
        { id: 'mon', date: '2026-09-21', slotType: 'dinner', channel: 'home_cook', title: 'Cook curry', projectedCostPence: 500, status: 'consumed' },
        { id: 'tue', date: '2026-09-22', slotType: 'dinner', channel: 'home_cook', title: 'Cook pasta', projectedCostPence: 400, status: 'consumed' },
        { id: 'wed', date: '2026-09-23', slotType: 'dinner', channel: 'takeaway', title: 'Takeaway', projectedCostPence: 1800, status: 'consumed' },
        // Upcoming planned slots total £46.00:
        { id: 'thu', date: '2026-09-24', slotType: 'dinner', channel: 'leftover', title: 'Leftovers', projectedCostPence: 200, status: 'planned' },
        { id: 'fri', date: '2026-09-25', slotType: 'dinner', channel: 'restaurant', title: 'Restaurant', projectedCostPence: 3000, status: 'planned' },
        { id: 'sat', date: '2026-09-26', slotType: 'dinner', channel: 'home_cook', title: 'Cook burgers', projectedCostPence: 800, status: 'planned' },
        { id: 'sun', date: '2026-09-27', slotType: 'dinner', channel: 'home_cook', title: 'Cook stir fry', projectedCostPence: 600, status: 'planned' }
      ];

      ledger.recordExpense({ id: 'e1', budgetCycleId: 'tight-cycle', householdId: 'h2', category: 'groceries', amountPence: 500, description: 'Groceries 1', incurredAt: new Date() });
      ledger.recordExpense({ id: 'e2', budgetCycleId: 'tight-cycle', householdId: 'h2', category: 'groceries', amountPence: 400, description: 'Groceries 2', incurredAt: new Date() });
      // Overspent on takeaway: £35 instead of £18 (+£17)
      ledger.recordExpense({ id: 'e3', budgetCycleId: 'tight-cycle', householdId: 'h2', category: 'takeaway', amountPence: 3500, description: 'Takeaway splurge', incurredAt: new Date() });

      // Total spent: 500 + 400 + 3500 = £44.00
      // Remaining budget: £75.00 - £44.00 = £31.00
      // Planned remaining: £46.00
      // Deficit: £46.00 - £31.00 = £15.00 over budget!
      const upcoming = slots.filter(s => s.status === 'planned');
      const check = ledger.evaluateReplanFeasibility('tight-cycle', upcoming);

      assert.equal(check.isFeasible, false);
      assert.equal(check.maxAffordableRemainingPence, 3100);
      assert.equal(check.currentRequestedRemainingPence, 4600);
      assert.equal(check.deficitPence, 1500); // Must save £15.00 to balance!
    });
  });

  describe('Financial Invariants & Property Tests', () => {
    it('guarantees TotalBudget === RemainingBudget + TotalActualSpend', () => {
      const ledger = new BudgetLedgerService();
      const cycle: BudgetCycle = {
        id: 'prop-cycle',
        householdId: 'h3',
        startDate: '2026-09-21',
        endDate: '2026-09-27',
        totalBudgetPence: 10000,
        targets: { groceriesTargetPence: 5000, takeawayTargetPence: 2000, restaurantTargetPence: 2000, bufferPence: 1000 },
        status: 'active'
      };
      ledger.registerBudgetCycle(cycle);

      const amounts = [1234, 567, 890, 2345, 111];
      let runningTotal = 0;

      for (let i = 0; i < amounts.length; i++) {
        ledger.recordExpense({
          id: `exp-${i}`,
          budgetCycleId: cycle.id,
          householdId: cycle.householdId,
          category: 'groceries',
          amountPence: amounts[i],
          description: `Item ${i}`,
          incurredAt: new Date()
        });
        runningTotal += amounts[i];

        const spent = ledger.getTotalActualSpendPence(cycle.id);
        const remaining = ledger.getRemainingBudgetPence(cycle.id);

        assert.equal(spent, runningTotal);
        assert.equal(cycle.totalBudgetPence, remaining + spent, `Invariant broken at step ${i}`);
      }
    });
  });
});
