-- 001_initial_schema.sql: Production Database Schema for Food Budget Optimizer
-- Handles integer pence monetary calculations, PostGIS geospatial queries, and pgvector embeddings.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 1. HOUSEHOLDS & USERS
CREATE TABLE IF NOT EXISTS households (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'GBP', -- ISO 4217
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'member', -- 'owner', 'member'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dietary_flags JSONB NOT NULL DEFAULT '[]', -- ['vegan', 'halal', 'keto']
    allergens JSONB NOT NULL DEFAULT '[]',     -- ['peanuts', 'gluten', 'dairy']
    disliked_ingredients JSONB NOT NULL DEFAULT '[]',
    max_cook_time_weekday_mins INT NOT NULL DEFAULT 45,
    max_cook_time_weekend_mins INT NOT NULL DEFAULT 90,
    cuisine_preferences JSONB NOT NULL DEFAULT '[]', -- ['italian', 'thai', 'mexican']
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS household_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    address_line_1 VARCHAR(255) NOT NULL,
    postcode VARCHAR(20) NOT NULL,
    geo_point GEOMETRY(Point, 4326) NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_household_location_geo ON household_locations USING GIST (geo_point);

-- 2. BUDGET CYCLES & EXPENSES (INTEGER PENCE)
CREATE TABLE IF NOT EXISTS budget_cycles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_budget_pence INT NOT NULL CHECK (total_budget_pence >= 0),
    groceries_target_pence INT NOT NULL DEFAULT 0,
    takeaway_target_pence INT NOT NULL DEFAULT 0,
    restaurant_target_pence INT NOT NULL DEFAULT 0,
    buffer_pence INT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'closed', 'rollover'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_budget_bounds CHECK (
        groceries_target_pence + takeaway_target_pence + restaurant_target_pence + buffer_pence <= total_budget_pence
    )
);

CREATE TABLE IF NOT EXISTS expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    budget_cycle_id UUID NOT NULL REFERENCES budget_cycles(id) ON DELETE CASCADE,
    household_id UUID NOT NULL REFERENCES households(id),
    category VARCHAR(50) NOT NULL, -- 'groceries', 'takeaway', 'restaurant', 'convenience'
    amount_pence INT NOT NULL CHECK (amount_pence >= 0),
    planned_slot_id UUID,          -- Links to meal_plan_slots if planned
    description VARCHAR(255) NOT NULL,
    vendor_name VARCHAR(100),
    receipt_image_url TEXT,
    incurred_at TIMESTAMPTZ NOT NULL,
    logged_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_budget_cycle ON expenses(budget_cycle_id);

-- 3. INGREDIENTS & GROCERY PRODUCTS
CREATE TABLE IF NOT EXISTS standard_ingredients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) UNIQUE NOT NULL,
    category VARCHAR(100) NOT NULL, -- 'produce', 'meat', 'dairy', 'dry_pantry'
    default_unit VARCHAR(20) NOT NULL, -- 'g', 'ml', 'unit'
    avg_shelf_life_days INT NOT NULL DEFAULT 7,
    is_pantry_staple BOOLEAN NOT NULL DEFAULT FALSE,
    embedding VECTOR(1536)
);

CREATE TABLE IF NOT EXISTS grocery_stores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    price_tier VARCHAR(20) NOT NULL, -- 'budget', 'mid', 'premium'
    location GEOMETRY(Point, 4326),
    postcode VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS grocery_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id UUID NOT NULL REFERENCES grocery_stores(id) ON DELETE CASCADE,
    standard_ingredient_id UUID REFERENCES standard_ingredients(id),
    product_name VARCHAR(255) NOT NULL,
    brand VARCHAR(100),
    barcode VARCHAR(50),
    package_size NUMERIC(10, 2) NOT NULL,
    package_unit VARCHAR(20) NOT NULL,
    price_pence INT NOT NULL CHECK (price_pence >= 0),
    normalized_price_per_unit_pence INT NOT NULL,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    affiliate_url TEXT,
    last_scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_grocery_products_ingredient ON grocery_products(standard_ingredient_id);

-- 4. PANTRY INVENTORY
CREATE TABLE IF NOT EXISTS pantry_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    standard_ingredient_id UUID NOT NULL REFERENCES standard_ingredients(id),
    quantity_remaining NUMERIC(10, 2) NOT NULL,
    unit VARCHAR(20) NOT NULL,
    purchased_at DATE NOT NULL DEFAULT CURRENT_DATE,
    expires_at DATE,
    source VARCHAR(50) NOT NULL DEFAULT 'groceries',
    is_depleted BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. RECIPES & RECIPE INGREDIENTS
CREATE TABLE IF NOT EXISTS recipes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    servings INT NOT NULL DEFAULT 4,
    prep_time_minutes INT NOT NULL,
    cook_time_minutes INT NOT NULL,
    instructions JSONB NOT NULL,
    dietary_attributes JSONB NOT NULL DEFAULT '[]',
    cuisine VARCHAR(100),
    source VARCHAR(50) NOT NULL DEFAULT 'curated',
    embedding VECTOR(1536)
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    standard_ingredient_id UUID NOT NULL REFERENCES standard_ingredients(id),
    quantity NUMERIC(10, 2) NOT NULL,
    unit VARCHAR(20) NOT NULL,
    is_optional BOOLEAN NOT NULL DEFAULT FALSE
);

-- 6. MEAL PLANS & SLOTS
CREATE TABLE IF NOT EXISTS meal_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    budget_cycle_id UUID NOT NULL REFERENCES budget_cycles(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    version INT NOT NULL DEFAULT 1,
    projected_cost_pence INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meal_plan_slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meal_plan_id UUID NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
    slot_date DATE NOT NULL,
    slot_type VARCHAR(20) NOT NULL, -- 'breakfast', 'lunch', 'dinner'
    channel VARCHAR(30) NOT NULL,   -- 'home_cook', 'leftover', 'takeaway', 'restaurant', 'convenience', 'skip'
    recipe_id UUID REFERENCES recipes(id),
    parent_slot_id UUID REFERENCES meal_plan_slots(id),
    restaurant_name VARCHAR(150),
    projected_cost_pence INT NOT NULL CHECK (projected_cost_pence >= 0),
    actual_cost_pence INT,
    status VARCHAR(30) NOT NULL DEFAULT 'planned', -- 'planned', 'consumed', 'skipped', 'replaced'
    notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_meal_plan_slots_date ON meal_plan_slots(meal_plan_id, slot_date);

-- 7. SHOPPING LISTS
CREATE TABLE IF NOT EXISTS shopping_lists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meal_plan_id UUID NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    total_projected_pence INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shopping_list_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shopping_list_id UUID NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
    grocery_product_id UUID REFERENCES grocery_products(id),
    standard_ingredient_id UUID NOT NULL REFERENCES standard_ingredients(id),
    quantity_packages INT NOT NULL DEFAULT 1,
    unit_price_pence INT NOT NULL,
    total_price_pence INT NOT NULL,
    is_pantry_covered BOOLEAN NOT NULL DEFAULT FALSE,
    is_purchased BOOLEAN NOT NULL DEFAULT FALSE
);
