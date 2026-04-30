ALTER TABLE "order_items" ADD COLUMN "modifiers_price" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "modifiers" jsonb DEFAULT '[]'::jsonb NOT NULL;
