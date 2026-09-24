"""
Domain models for the Food Budget Optimization & Replanning Engine.
Uses Python standard library dataclasses for high-performance zero-dependency execution.
All monetary amounts are strictly in integer minor units (pence).
"""

from dataclasses import dataclass, field, replace
from enum import Enum
from typing import List, Optional, Dict, Set


class MealChannel(str, Enum):
    HOME_COOK = "home_cook"
    LEFTOVER = "leftover"
    TAKEAWAY = "takeaway"
    RESTAURANT = "restaurant"
    CONVENIENCE = "convenience"
    SKIP = "skip"


class SlotStatus(str, Enum):
    PLANNED = "planned"
    CONSUMED = "consumed"
    SKIPPED = "skipped"
    REPLACED = "replaced"


@dataclass
class IngredientRequirement:
    standard_name: str
    quantity: float
    unit: str
    is_perishable: bool = False
    shelf_life_days: int = 7


@dataclass
class Recipe:
    id: str
    title: str
    prep_time_minutes: int
    cook_time_minutes: int
    cash_purchase_cost_pence: int  # Full retail grocery pack purchases needed
    amortized_cost_pence: int      # Fractional ingredient value used
    servings: int = 4
    yields_leftover_servings: int = 0
    ingredients: List[IngredientRequirement] = field(default_factory=list)
    allergens: List[str] = field(default_factory=list)
    dietary_tags: List[str] = field(default_factory=list)
    cuisine: Optional[str] = None


@dataclass
class DiningOption:
    id: str
    name: str
    channel: MealChannel  # TAKEAWAY or RESTAURANT
    cost_pence: int
    cuisine: Optional[str] = None
    allergens: List[str] = field(default_factory=list)


@dataclass
class PantryItem:
    id: str
    standard_name: str
    quantity_remaining: float
    unit: str
    days_until_expiry: int


@dataclass
class MealSlot:
    id: str
    date: str  # YYYY-MM-DD
    channel: MealChannel
    title: str
    projected_cost_pence: int
    slot_type: str = "dinner"
    recipe_id: Optional[str] = None
    parent_slot_id: Optional[str] = None  # If leftover, links to cook slot
    actual_cost_pence: Optional[int] = None
    status: SlotStatus = SlotStatus.PLANNED

    def clone(self) -> 'MealSlot':
        return replace(self)


@dataclass
class UserConstraints:
    household_size: int = 1
    allergens: List[str] = field(default_factory=list)
    disliked_ingredients: List[str] = field(default_factory=list)
    max_cook_time_minutes: int = 60
    preferred_cuisines: List[str] = field(default_factory=list)


@dataclass
class RebalanceOption:
    strategy_code: str  # e.g., 'PANTRY_STAPLE', 'BATCH_LEFTOVER', 'CHANNEL_DOWNGRADE'
    title: str
    description: str
    rebalanced_slots: List[MealSlot]
    total_remaining_cost_pence: int
    net_savings_pence: int
    is_within_budget: bool
