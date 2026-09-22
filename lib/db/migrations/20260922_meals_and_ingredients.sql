CREATE TABLE IF NOT EXISTS "meals" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "normalized_name" text NOT NULL UNIQUE,
  "category" text NOT NULL,
  "type" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "total_calories" numeric(14,3) NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "meals_type_check" CHECK ("type" IN ('single', 'set'))
);

CREATE TABLE IF NOT EXISTS "meal_ingredients" (
  "id" serial PRIMARY KEY,
  "meal_id" integer NOT NULL REFERENCES "meals"("id") ON DELETE CASCADE,
  "inventory_item_id" integer NOT NULL REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
  "quantity" numeric(14,3) NOT NULL,
  "unit" text NOT NULL,
  "calories_per_unit" numeric(14,3) NOT NULL,
  "total_calories" numeric(14,3) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "meal_ingredients_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "meal_ingredients_calories_per_unit_check" CHECK ("calories_per_unit" >= 0),
  CONSTRAINT "meal_ingredients_total_calories_check" CHECK ("total_calories" >= 0)
);

CREATE INDEX IF NOT EXISTS "meal_ingredients_meal_id_idx" ON "meal_ingredients" ("meal_id");
CREATE INDEX IF NOT EXISTS "meal_ingredients_inventory_item_id_idx" ON "meal_ingredients" ("inventory_item_id");