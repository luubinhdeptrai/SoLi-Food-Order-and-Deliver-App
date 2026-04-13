CREATE TYPE "public"."menu_item_category" AS ENUM('salads', 'desserts', 'breads', 'mains', 'drinks', 'sides');--> statement-breakpoint
CREATE TYPE "public"."menu_item_status" AS ENUM('available', 'unavailable', 'out_of_stock');--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" double precision NOT NULL,
	"sku" text,
	"category" "menu_item_category" NOT NULL,
	"status" "menu_item_status" DEFAULT 'available' NOT NULL,
	"image_url" text,
	"is_available" boolean DEFAULT true NOT NULL,
	"tags" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
