CREATE TABLE IF NOT EXISTS "inventory_material_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "requested_date" date NOT NULL,
  "requester_id" integer NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "meal_schedule_entry_id" integer REFERENCES "meal_schedule_entries"("id") ON DELETE set null,
  "note" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "inventory_material_requests_status_check" CHECK ("inventory_material_requests"."status" IN ('pending', 'approved', 'rejected', 'fulfilled'))
);
CREATE INDEX IF NOT EXISTS "inventory_material_requests_requester_id_idx" ON "inventory_material_requests" ("requester_id");
CREATE INDEX IF NOT EXISTS "inventory_material_requests_requested_date_idx" ON "inventory_material_requests" ("requested_date");

CREATE TABLE IF NOT EXISTS "inventory_material_request_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "request_id" integer NOT NULL REFERENCES "inventory_material_requests"("id") ON DELETE cascade,
  "inventory_item_id" integer NOT NULL REFERENCES "inventory_items"("id") ON DELETE restrict,
  "item_name" text NOT NULL,
  "unit" text NOT NULL,
  "quantity" numeric(14,3) NOT NULL,
  CONSTRAINT "inventory_material_request_items_quantity_check" CHECK ("inventory_material_request_items"."quantity" > 0),
  CONSTRAINT "inventory_material_request_items_request_item_unique" UNIQUE ("request_id", "inventory_item_id")
);