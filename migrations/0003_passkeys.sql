CREATE TABLE `passkeys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role` text NOT NULL,
	`user_id` integer NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`nickname` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkeys_credential_id_unique` ON `passkeys` (`credential_id`);
--> statement-breakpoint
ALTER TABLE `platform_settings` ADD `require_passkey` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `platform_settings` ADD `email_code_enabled` integer DEFAULT 1 NOT NULL;
