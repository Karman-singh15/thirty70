CREATE INDEX "room_participants_active_user_idx" ON "room_participants" USING btree ("user_id") WHERE "room_participants"."left_at" is null;--> statement-breakpoint
CREATE INDEX "rooms_updated_at_idx" ON "rooms" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "sessions_room_idx" ON "sessions" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "turns_session_idx" ON "turns" USING btree ("session_id");