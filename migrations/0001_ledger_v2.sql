ALTER TABLE `consents` ADD `support` text;--> statement-breakpoint
ALTER TABLE `consents` ADD `reason` text;--> statement-breakpoint
ALTER TABLE `entries` ADD `carried_from` text;--> statement-breakpoint
ALTER TABLE `entry_versions` ADD `payload` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `tier` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `seat_cap` integer;--> statement-breakpoint
ALTER TABLE `rooms` ADD `turn_seconds` integer;--> statement-breakpoint
ALTER TABLE `rooms` ADD `seal_threshold` text DEFAULT 'consensus' NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `ledger_version` integer;--> statement-breakpoint
ALTER TABLE `rooms` ADD `sealed_ledger` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `continues_from` text;