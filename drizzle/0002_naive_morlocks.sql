CREATE TYPE "public"."user_plan" AS ENUM('free', 'pro');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan" "user_plan" DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "dodo_customer_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "dodo_subscription_id" text;