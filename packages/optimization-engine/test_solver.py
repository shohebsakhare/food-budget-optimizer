"""
Unit and scenario tests for the Replanning Solver using Python's standard unittest.
"""

import unittest
from domain_models import (
    MealSlot,
    MealChannel,
    Recipe,
    DiningOption,
    PantryItem,
    UserConstraints,
)
from replan_solver import ReplanningSolver


class TestReplanningSolver(unittest.TestCase):
    def setUp(self):
        self.recipes = [
            Recipe(
                id="rec-chicken-curry",
                title="Chicken Curry",
                prep_time_minutes=15,
                cook_time_minutes=30,
                cash_purchase_cost_pence=500,  # £5.00
                amortized_cost_pence=420,
                yields_leftover_servings=2,
                allergens=[],
                dietary_tags=["gluten_free"],
            ),
            Recipe(
                id="rec-pasta-pomodoro",
                title="Pasta Pomodoro",
                prep_time_minutes=10,
                cook_time_minutes=15,
                cash_purchase_cost_pence=400,  # £4.00
                amortized_cost_pence=300,
                allergens=["gluten"],
                dietary_tags=["vegetarian"],
            ),
            Recipe(
                id="rec-peanut-satay",
                title="Peanut Chicken Satay",
                prep_time_minutes=20,
                cook_time_minutes=20,
                cash_purchase_cost_pence=650,
                amortized_cost_pence=550,
                allergens=["peanuts"],
            ),
        ]

        self.dining = [
            DiningOption(
                id="dine-thai-takeaway",
                name="Thai Orchid Takeaway",
                channel=MealChannel.TAKEAWAY,
                cost_pence=1800,  # £18.00
            ),
            DiningOption(
                id="dine-italian-restaurant",
                name="Trattoria Bella",
                channel=MealChannel.RESTAURANT,
                cost_pence=3000,  # £30.00
            ),
        ]

        self.solver = ReplanningSolver(self.recipes, self.dining)

    def test_wednesday_variance_replan_options(self):
        """
        User spent £25 instead of £18 on Wednesday (+£7 overspend).
        Remaining slots: Thu (£2), Fri (£30), Sat (£8), Sun (£6).
        Remaining budget: £86.00 (from £120 - £34).
        Solver proposes rebalance options to recover £7 or optimize budget.
        """
        upcoming_slots = [
            MealSlot(id="thu", date="2026-09-24", channel=MealChannel.LEFTOVER, title="Leftovers", projected_cost_pence=200),
            MealSlot(id="fri", date="2026-09-25", channel=MealChannel.RESTAURANT, title="Restaurant", projected_cost_pence=3000),
            MealSlot(id="sat", date="2026-09-26", channel=MealChannel.HOME_COOK, title="Cook burgers", projected_cost_pence=800),
            MealSlot(id="sun", date="2026-09-27", channel=MealChannel.HOME_COOK, title="Cook stir fry", projected_cost_pence=600),
        ]

        pantry = [
            PantryItem(id="p1", standard_name="basmati rice", quantity_remaining=1.0, unit="kg", days_until_expiry=30)
        ]
        constraints = UserConstraints(household_size=1, allergens=[], max_cook_time_minutes=60)

        options = self.solver.solve_rebalance(
            remaining_budget_pence=8600,
            upcoming_slots=upcoming_slots,
            pantry=pantry,
            constraints=constraints,
            deficit_to_recover_pence=700,
        )

        self.assertGreaterEqual(len(options), 2)

        # Strategy 1: Channel Downgrade (Friday Restaurant -> Home Cook)
        channel_opt = next((o for o in options if o.strategy_code == "CHANNEL_DOWNGRADE"), None)
        self.assertIsNotNone(channel_opt)
        self.assertGreaterEqual(channel_opt.net_savings_pence, 2500)
        self.assertTrue(channel_opt.is_within_budget)

        # Strategy 2: Batch Leftover (Saturday cook -> Sunday leftover)
        batch_opt = next((o for o in options if o.strategy_code == "BATCH_LEFTOVER"), None)
        self.assertIsNotNone(batch_opt)
        self.assertEqual(batch_opt.net_savings_pence, 600)
        self.assertTrue(batch_opt.is_within_budget)

    def test_tight_budget_deficit_recovery(self):
        """
        Tight budget where user has £31.00 remaining, but planned upcoming slots total £46.00.
        Deficit is £15.00. Solver must find an option that brings total <= £31.00.
        """
        upcoming_slots = [
            MealSlot(id="thu", date="2026-09-24", channel=MealChannel.LEFTOVER, title="Leftovers", projected_cost_pence=200),
            MealSlot(id="fri", date="2026-09-25", channel=MealChannel.RESTAURANT, title="Restaurant", projected_cost_pence=3000),
            MealSlot(id="sat", date="2026-09-26", channel=MealChannel.HOME_COOK, title="Cook burgers", projected_cost_pence=800),
            MealSlot(id="sun", date="2026-09-27", channel=MealChannel.HOME_COOK, title="Cook stir fry", projected_cost_pence=600),
        ]

        constraints = UserConstraints(household_size=1, allergens=[], max_cook_time_minutes=60)

        options = self.solver.solve_rebalance(
            remaining_budget_pence=3100,
            upcoming_slots=upcoming_slots,
            pantry=[],
            constraints=constraints,
            deficit_to_recover_pence=1500,
        )

        channel_opt = next(o for o in options if o.strategy_code == "CHANNEL_DOWNGRADE")
        self.assertTrue(channel_opt.is_within_budget)
        self.assertLessEqual(channel_opt.total_remaining_cost_pence, 3100)

    def test_allergen_safety_filtering(self):
        """
        User has gluten and peanut allergies. Solver must never recommend Pasta or Satay.
        """
        upcoming_slots = [
            MealSlot(id="fri", date="2026-09-25", channel=MealChannel.RESTAURANT, title="Restaurant", projected_cost_pence=3000),
        ]

        constraints = UserConstraints(household_size=1, allergens=["gluten", "peanuts"], max_cook_time_minutes=60)

        options = self.solver.solve_rebalance(
            remaining_budget_pence=5000,
            upcoming_slots=upcoming_slots,
            pantry=[],
            constraints=constraints,
        )

        channel_opt = next(o for o in options if o.strategy_code == "CHANNEL_DOWNGRADE")
        swapped_slot = channel_opt.rebalanced_slots[0]
        self.assertEqual(swapped_slot.recipe_id, "rec-chicken-curry")


if __name__ == "__main__":
    unittest.main()
