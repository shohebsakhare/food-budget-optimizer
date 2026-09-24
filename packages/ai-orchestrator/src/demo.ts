import {
  BudgetLedgerService,
  BudgetCycle,
  MealSlot,
  Money,
  VarianceReport
} from '@food-budget/core-ledger';
import { FoodBudgetOrchestrator } from './agent-state-machine.js';

function printHeader(title: string) {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${title.toUpperCase()}`);
  console.log('='.repeat(70));
}

function printPlanTable(slots: MealSlot[]) {
  console.log('\n' + '-'.repeat(70));
  console.log(
    'Day'.padEnd(10) +
    'Channel'.padEnd(15) +
    'Meal Description'.padEnd(30) +
    'Cost'.padEnd(10) +
    'Status'
  );
  console.log('-'.repeat(70));

  for (const s of slots) {
    const cost = Money.format(s.actualCostPence ?? s.projectedCostPence);
    const day = s.date.padEnd(10);
    const channel = s.channel.padEnd(15);
    const title = s.title.slice(0, 28).padEnd(30);
    const status = (s.status === 'consumed' ? '✓ Consumed' : '⏳ Planned');
    console.log(`${day}${channel}${title}${cost.padEnd(10)}${status}`);
  }
  console.log('-'.repeat(70));
}

async function runLiveDemo() {
  printHeader('AI Food Budget Optimizer - Live Simulation');

  const ledger = new BudgetLedgerService();

  // 1. Initial Weekly Budget
  const totalBudget = Money.fromDecimal(120.00);
  const cycle: BudgetCycle = {
    id: 'cycle-wk-1',
    householdId: 'household-shohei',
    startDate: '2026-09-21',
    endDate: '2026-09-27',
    totalBudgetPence: totalBudget,
    targets: {
      groceriesTargetPence: 6000,
      takeawayTargetPence: 2000,
      restaurantTargetPence: 3500,
      bufferPence: 500
    },
    status: 'active'
  };
  ledger.registerBudgetCycle(cycle);

  console.log(`\n💰 Weekly Food Budget Set: ${Money.format(totalBudget)}`);

  // 2. Initial Meal Plan Slots
  const slots: MealSlot[] = [
    { id: 'mon', date: 'Monday', slotType: 'dinner', channel: 'home_cook', title: 'Cook chicken curry', projectedCostPence: 500, status: 'planned' },
    { id: 'tue', date: 'Tuesday', slotType: 'dinner', channel: 'home_cook', title: 'Cook pasta', projectedCostPence: 400, status: 'planned' },
    { id: 'wed', date: 'Wednesday', slotType: 'dinner', channel: 'takeaway', title: 'Takeaway', projectedCostPence: 1800, status: 'planned' },
    { id: 'thu', date: 'Thursday', slotType: 'dinner', channel: 'leftover', title: 'Leftovers', projectedCostPence: 200, status: 'planned' },
    { id: 'fri', date: 'Friday', slotType: 'dinner', channel: 'restaurant', title: 'Restaurant', projectedCostPence: 3000, status: 'planned' },
    { id: 'sat', date: 'Saturday', slotType: 'dinner', channel: 'home_cook', title: 'Cook burgers', projectedCostPence: 800, status: 'planned' },
    { id: 'sun', date: 'Sunday', slotType: 'dinner', channel: 'home_cook', title: 'Cook stir fry', projectedCostPence: 600, status: 'planned' }
  ];

  const initialProjected = Money.sum(slots.map(s => s.projectedCostPence));
  const initialRemaining = totalBudget - initialProjected;

  console.log(`📅 Initial 7-Day Plan Generated:`);
  printPlanTable(slots);
  console.log(`Projected spend: ${Money.format(initialProjected)} | Remaining buffer: ${Money.format(initialRemaining)}`);

  // 3. Simulate Mon and Tue consumption
  printHeader('Mid-Week Progress: Monday & Tuesday Consumed As Planned');
  slots[0].status = 'consumed';
  slots[0].actualCostPence = 500;
  ledger.recordExpense({
    id: 'e1',
    budgetCycleId: cycle.id,
    householdId: 'h1',
    category: 'groceries',
    amountPence: 500,
    plannedSlotId: 'mon',
    description: 'Chicken curry ingredients',
    incurredAt: new Date('2026-09-21')
  });

  slots[1].status = 'consumed';
  slots[1].actualCostPence = 400;
  ledger.recordExpense({
    id: 'e2',
    budgetCycleId: cycle.id,
    householdId: 'h1',
    category: 'groceries',
    amountPence: 400,
    plannedSlotId: 'tue',
    description: 'Pasta ingredients',
    incurredAt: new Date('2026-09-22')
  });

  console.log(`✓ Mon: Chicken curry cooked (${Money.format(500)})`);
  console.log(`✓ Tue: Pasta cooked (${Money.format(400)})`);

  // 4. Conversational Interaction
  printHeader('User Interaction: Wednesday Spending Variance');
  const userMessage = "I spent £25 instead of £18 on Wednesday takeaway.";
  console.log(`🗣️  User says: "${userMessage}"\n`);

  const orchestrator = new FoodBudgetOrchestrator(ledger, slots);
  const response = await orchestrator.handleUserExpenseStatement(cycle.id, userMessage);

  console.log(`🤖 AI Assistant Response:`);
  console.log(`   "${response.messageText}"`);

  if (response.optionsCard) {
    console.log(`\n📋 ${response.optionsCard.title}:`);
    console.log(`   ${response.optionsCard.description}`);

    response.optionsCard.options.forEach((opt, idx) => {
      console.log(`\n   [Option ${idx + 1}] ${opt.title}`);
      console.log(`   - Details: ${opt.description}`);
      console.log(`   - Savings: ${opt.savingsFormatted} | New Remaining Plan: ${opt.newTotalFormatted}`);
    });
  }

  // 5. Applying Option 1
  printHeader('User Action: Accepts Option 1 (Swap Friday Dining to Cooking)');
  console.log('👉 User selected Option 1: Swap Friday Restaurant to Gourmet Home Cooking.\n');

  const updatedSlots = orchestrator.applyRebalanceOption('CHANNEL_DOWNGRADE');
  printPlanTable(updatedSlots);

  // 6. Final Ledger Verification
  printHeader('Deterministic Ledger Summary & Financial Invariant Check');
  const report: VarianceReport = ledger.calculateVarianceReport(cycle.id, updatedSlots);

  console.log(`Initial Budget:                ${Money.format(report.totalBudgetPence)}`);
  console.log(`Total Spent To Date:           ${Money.format(report.totalActualSpendPence)} (Mon: £5, Tue: £4, Wed: £25)`);
  console.log(`Remaining Cash In Bank:        ${Money.format(report.remainingBudgetPence)}`);
  console.log(`Projected Upcoming Spend:      ${Money.format(report.projectedRemainingSpendPence)} (Thu: £2, Fri: £5, Sat: £8, Sun: £6)`);
  console.log(`Projected Final Weekly Total:  ${Money.format(report.projectedFinalSpendPence)}`);
  console.log(`Surplus / Unallocated Buffer:  ${Money.format(report.totalBudgetPence - report.projectedFinalSpendPence)}`);

  const isBalanced = report.projectedFinalSpendPence <= report.totalBudgetPence;
  console.log(`\nStatus: ${isBalanced ? '✅ FULLY BALANCED & WITHIN BUDGET' : '❌ DEFICIT DETECTED'}`);
  console.log('='.repeat(70) + '\n');
}

runLiveDemo().catch(console.error);
