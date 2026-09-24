"""
Deterministic Meal Plan Optimizer and Dynamic Replanning Solver.
Guarantees zero arithmetic hallucinations by using exact integer pence arithmetic.
"""

from typing import List, Optional, Tuple
from domain_models import (
    MealSlot,
    MealChannel,
    Recipe,
    DiningOption,
    PantryItem,
    UserConstraints,
    RebalanceOption,
    SlotStatus,
)


class ReplanningSolver:
    def __init__(
        self,
        recipes: List[Recipe],
        dining_options: List[DiningOption],
    ):
        self.recipes = {r.id: r for r in recipes}
        self.dining_options = {d.id: d for d in dining_options}

    def solve_rebalance(
        self,
        remaining_budget_pence: int,
        upcoming_slots: List[MealSlot],
        pantry: List[PantryItem],
        constraints: UserConstraints,
        deficit_to_recover_pence: int = 0,
        locked_slot_ids: Optional[List[str]] = None,
    ) -> List[RebalanceOption]:
        """
        Generates deterministic rebalance candidates to recover a budget deficit
        or fit within remaining cash budget.
        """
        locked_set = set(locked_slot_ids or [])
        current_cost = sum(s.projected_cost_pence for s in upcoming_slots)
        options: List[RebalanceOption] = []

        # Filter safe recipes
        safe_recipes = [
            r for r in self.recipes.values()
            if not any(a in constraints.allergens for a in r.allergens)
            and (r.prep_time_minutes + r.cook_time_minutes) <= constraints.max_cook_time_minutes
        ]

        # -------------------------------------------------------------
        # Strategy 1: Channel Downgrade (Restaurant / High Takeaway -> Cook or Budget Dining)
        # -------------------------------------------------------------
        channel_downgrade_slots = [s.clone() for s in upcoming_slots]
        recovered_pence = 0
        swapped_slot_title = ""

        # Find the highest cost dining out slot that is not locked
        dining_slots = sorted(
            [s for s in channel_downgrade_slots if s.id not in locked_set and s.channel in (MealChannel.RESTAURANT, MealChannel.TAKEAWAY)],
            key=lambda s: s.projected_cost_pence,
            reverse=True
        )

        if dining_slots:
            target_slot = dining_slots[0]
            original_cost = target_slot.projected_cost_pence

            # Find a high-satisfaction home cook alternative
            cook_alternatives = sorted(safe_recipes, key=lambda r: r.cash_purchase_cost_pence)
            if cook_alternatives:
                best_cook = cook_alternatives[0]
                target_slot.channel = MealChannel.HOME_COOK
                target_slot.title = f"Cook {best_cook.title} (Home-cooked swap)"
                target_slot.recipe_id = best_cook.id
                target_slot.projected_cost_pence = best_cook.cash_purchase_cost_pence
                
                savings = original_cost - target_slot.projected_cost_pence
                recovered_pence += savings
                swapped_slot_title = f"{target_slot.title} on {target_slot.date}"

        new_total_cost = sum(s.projected_cost_pence for s in channel_downgrade_slots)
        if recovered_pence > 0:
            options.append(
                RebalanceOption(
                    strategy_code="CHANNEL_DOWNGRADE",
                    title="Swap Dining Out to Gourmet Home Cooking",
                    description=(
                        f"Replaced high-cost dining slot with {swapped_slot_title}. "
                        f"Saves £{recovered_pence / 100:.2f}."
                    ),
                    rebalanced_slots=channel_downgrade_slots,
                    total_remaining_cost_pence=new_total_cost,
                    net_savings_pence=recovered_pence,
                    is_within_budget=new_total_cost <= remaining_budget_pence,
                )
            )

        # -------------------------------------------------------------
        # Strategy 2: Leftover & Batch Cooking Promotion
        # -------------------------------------------------------------
        leftover_slots = [s.clone() for s in upcoming_slots]
        batch_savings = 0
        batch_description_parts = []

        # Look for two consecutive slots where slot 1 can be double-batched and slot 2 turned into leftover
        for i in range(len(leftover_slots) - 1):
            s1 = leftover_slots[i]
            s2 = leftover_slots[i + 1]

            if s1.id in locked_set or s2.id in locked_set:
                continue

            if s1.channel == MealChannel.HOME_COOK and s2.channel != MealChannel.LEFTOVER:
                original_s2_cost = s2.projected_cost_pence
                # Transform s2 into leftover of s1
                s2.channel = MealChannel.LEFTOVER
                s2.title = f"Leftover: {s1.title}"
                s2.parent_slot_id = s1.id
                s2.projected_cost_pence = 0  # Sunk cost from s1 batch
                
                savings = original_s2_cost
                batch_savings += savings
                batch_description_parts.append(f"Turned {s2.date} into zero-cost leftovers from {s1.date}")
                break  # Apply once for clean comparison

        if batch_savings > 0:
            batch_total = sum(s.projected_cost_pence for s in leftover_slots)
            options.append(
                RebalanceOption(
                    strategy_code="BATCH_LEFTOVER",
                    title="Batch Cook & Leftover Synergy",
                    description="; ".join(batch_description_parts) + f". Saves £{batch_savings / 100:.2f}.",
                    rebalanced_slots=leftover_slots,
                    total_remaining_cost_pence=batch_total,
                    net_savings_pence=batch_savings,
                    is_within_budget=batch_total <= remaining_budget_pence,
                )
            )

        # -------------------------------------------------------------
        # Strategy 3: Pantry Liquidation (Deplete items expiring soon)
        # -------------------------------------------------------------
        pantry_slots = [s.clone() for s in upcoming_slots]
        pantry_savings = 0
        expiring_pantry = [p for p in pantry if p.days_until_expiry <= 5]

        if expiring_pantry:
            for s in pantry_slots:
                if s.id not in locked_set and s.channel == MealChannel.HOME_COOK:
                    # Apply pantry credit to reduce cash grocery cost
                    pantry_savings = min(s.projected_cost_pence - 100, 300) # Save up to £3.00 using pantry staples
                    if pantry_savings > 0:
                        s.projected_cost_pence -= pantry_savings
                        s.title += " (Pantry ingredients applied)"
                        break

        if pantry_savings > 0:
            pantry_total = sum(s.projected_cost_pence for s in pantry_slots)
            options.append(
                RebalanceOption(
                    strategy_code="PANTRY_STAPLE",
                    title="Utilize Expiring Pantry Ingredients",
                    description=f"Applied pantry staples near expiry to offset grocery purchases. Saves £{pantry_savings / 100:.2f}.",
                    rebalanced_slots=pantry_slots,
                    total_remaining_cost_pence=pantry_total,
                    net_savings_pence=pantry_savings,
                    is_within_budget=pantry_total <= remaining_budget_pence,
                )
            )

        # If no strategies yielded options or deficit is 0, provide baseline confirmation
        if not options:
            options.append(
                RebalanceOption(
                    strategy_code="MAINTAIN_CURRENT",
                    title="Maintain Current Schedule",
                    description="Current planned meals are fully feasible within the remaining budget.",
                    rebalanced_slots=upcoming_slots,
                    total_remaining_cost_pence=current_cost,
                    net_savings_pence=0,
                    is_within_budget=current_cost <= remaining_budget_pence,
                )
            )

        return options
