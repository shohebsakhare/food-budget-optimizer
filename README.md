# Food Budget Optimizer 🍲💰

> Production-ready AI-powered food budget planning and dynamic replanning application.

## Core Architectural Principle: Zero-Hallucination Arithmetic
The system enforces strict domain separation:
- **Probabilistic AI Layer:** Conversational dialogue, intent extraction, meal and recipe creative synthesis.
- **Deterministic Ledger & Optimizer:** 100% deterministic arithmetic in integer minor units (pence/cents), double-entry transaction ledgers, constraint satisfaction solvers, and dynamic replanning cascades. **Never relies on an LLM for financial arithmetic.**

---

## Repository Structure

```
food-budget-optimizer/
├── db/
│   └── migrations/
│       └── 001_initial_schema.sql       # PostgreSQL 16 DDL (PostGIS + pgvector + Integer pence)
├── packages/
│   ├── core-ledger/                     # Deterministic Financial Ledger & Variance Engine (TypeScript)
│   │   ├── src/
│   │   │   ├── money.ts                 # Integer minor unit math & IEEE-754 overflow guards
│   │   │   ├── types.ts                 # Typed schemas for Budgets, Slots, Expenses, Variances
│   │   │   ├── ledger.ts                # Double-entry ledger, variance report, feasibility evaluator
│   │   │   └── ledger.test.ts           # Financial invariant & scenario tests
│   ├── optimization-engine/             # Replanning & Constraint Optimization Engine (Python)
│   │   ├── domain_models.py             # Typed dataclass models for channels, recipes, pantry
│   │   ├── replan_solver.py             # Multi-tier cascade replanning solver (Pantry -> Batch -> Channel)
│   │   └── test_solver.py               # Unit & variance test cases (Wednesday £25 vs £18)
│   └── ai-orchestrator/                 # Conversational AI Agent State Machine & Tool Rig (TypeScript)
│       ├── src/
│       │   ├── agent-tools.ts           # JSON schemas for structured LLM tool calling
│       │   ├── agent-state-machine.ts   # Interactive conversation handler & replan card generator
│       │   └── agent-orchestrator.test.ts # End-to-end integration test of user prompt flow
├── package.json
└── tsconfig.base.json
```

---

## Verified Scenario: Wednesday £25 Takeaway Overspend

```
Weekly Budget: £120.00
Mon: Cook chicken curry (£5.00)
Tue: Cook pasta (£4.00)
Wed: Takeaway (£18.00 planned)
Thu: Leftovers (£2.00)
Fri: Restaurant (£30.00)
Sat: Cook burgers (£8.00)
Sun: Cook stir fry (£6.00)

Initial Projected Spend: £73.00 | Remaining Buffer: £47.00

User event: "I spent £25 instead of £18 on Wednesday takeaway."
1. Deterministic Ledger records £25.00 (+£7.00 variance).
2. Cash remaining: £120 - £34 = £86.00.
3. Replanning solver triggers and generates compensatory options:
   - Option A (Channel Downgrade): Swap Friday Restaurant (£30.00) -> Home Cook (£5.00), saving £25.00!
   - Option B (Batch Leftover): Cook double batch on Saturday, turning Sunday into free leftovers, saving £6.00!
```

---

## Running the Test Suites

### 1. TypeScript Core Ledger & AI Orchestrator
```bash
npm install
npm test
```

### 2. Python Constraint Solver
```bash
python packages/optimization-engine/test_solver.py
```
