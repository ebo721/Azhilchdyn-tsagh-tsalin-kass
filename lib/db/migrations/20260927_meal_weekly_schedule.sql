CREATE TABLE IF NOT EXISTS "meal_schedule_slots" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "sort_order" integer NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "meal_schedule_slots_sort_order_check" CHECK ("sort_order" >= 0)
);

CREATE TABLE IF NOT EXISTS "meal_schedule_entries" (
  "id" serial PRIMARY KEY,
  "date" date NOT NULL,
  "slot_id" integer NOT NULL REFERENCES "meal_schedule_slots"("id") ON DELETE RESTRICT,
  "kind" text NOT NULL,
  "meal_id" integer REFERENCES "meals"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "meal_schedule_entries_kind_check" CHECK ("kind" IN ('meal', 'break')),
  CONSTRAINT "meal_schedule_entries_meal_check" CHECK (
    ("kind" = 'meal' AND "meal_id" IS NOT NULL)
    OR ("kind" = 'break' AND "meal_id" IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "meal_schedule_slots_name_idx" ON "meal_schedule_slots" ("name");
CREATE UNIQUE INDEX IF NOT EXISTS "meal_schedule_slots_sort_order_idx" ON "meal_schedule_slots" ("sort_order");
CREATE UNIQUE INDEX IF NOT EXISTS "meal_schedule_entries_date_slot_idx" ON "meal_schedule_entries" ("date", "slot_id");
CREATE INDEX IF NOT EXISTS "meal_schedule_entries_date_idx" ON "meal_schedule_entries" ("date");
CREATE INDEX IF NOT EXISTS "meal_schedule_entries_meal_id_idx" ON "meal_schedule_entries" ("meal_id");

INSERT INTO "meal_schedule_slots" ("name", "start_time", "end_time", "sort_order")
VALUES
  ('Өглөөний цай', '08:00', '09:00', 10),
  ('Өдрийн хоол', '12:00', '13:00', 20),
  ('Оройн хоол', '18:00', '19:00', 30)
ON CONFLICT DO NOTHING;