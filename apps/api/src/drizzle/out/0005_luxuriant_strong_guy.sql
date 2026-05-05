CREATE TYPE "public"."payment_status" AS ENUM('pending', 'awaiting_ipn', 'completed', 'failed', 'refund_pending', 'refunded');--> statement-breakpoint
CREATE TABLE "ordering_delivery_zone_snapshots" (
	"zone_id" uuid PRIMARY KEY NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"radius_km" double precision NOT NULL,
	"base_fee" numeric(10, 2) NOT NULL,
	"per_km_rate" numeric(10, 2) NOT NULL,
	"avg_speed_kmh" real NOT NULL,
	"prep_time_minutes" real NOT NULL,
	"buffer_minutes" real NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"payment_url" text,
	"provider_txn_id" text,
	"vnp_response_code" text,
	"raw_ipn_payload" jsonb,
	"ipn_received_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"refund_initiated_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"refund_retry_count" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_transactions_provider_txn_id_unique" UNIQUE("provider_txn_id")
);
--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD COLUMN "base_fee" numeric(10, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD COLUMN "per_km_rate" numeric(10, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD COLUMN "avg_speed_kmh" real DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD COLUMN "prep_time_minutes" real DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD COLUMN "buffer_minutes" real DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "cuisine_type" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "cover_image_url" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_fee" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "estimated_delivery_minutes" real;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipper_id" uuid;--> statement-breakpoint
ALTER TABLE "ordering_restaurant_snapshots" ADD COLUMN "cuisine_type" text;--> statement-breakpoint
ALTER TABLE "ordering_restaurant_snapshots" ADD COLUMN "owner_id" uuid NOT NULL;--> statement-breakpoint
CREATE INDEX "ordering_delivery_zone_snapshots_restaurant_idx" ON "ordering_delivery_zone_snapshots" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "idx_ptxn_order_id" ON "payment_transactions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_ptxn_customer_id" ON "payment_transactions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_ptxn_expires_at" ON "payment_transactions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "restaurants_approved_open_idx" ON "restaurants" USING btree ("is_approved","is_open");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_categories_restaurant_name_uidx" ON "menu_categories" USING btree ("restaurant_id","name");--> statement-breakpoint
CREATE INDEX "menu_items_tags_gin_idx" ON "menu_items" USING gin ("tags");--> statement-breakpoint
ALTER TABLE "delivery_zones" DROP COLUMN "delivery_fee";--> statement-breakpoint
ALTER TABLE "delivery_zones" DROP COLUMN "estimated_minutes";--> statement-breakpoint
ALTER TABLE "ordering_restaurant_snapshots" DROP COLUMN "delivery_radius_km";