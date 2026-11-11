CREATE TABLE `admins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admins_email_unique` ON `admins` (`email`);--> statement-breakpoint
CREATE TABLE `agenda_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`prev_hash` text,
	`hash` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `blocked_countries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `consents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_id` integer NOT NULL,
	`seat_id` integer NOT NULL,
	`confirmed` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `data_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`requester` text NOT NULL,
	`detail` text,
	`status` text DEFAULT 'open' NOT NULL,
	`handler` text,
	`created_at` integer NOT NULL,
	`decided_at` integer
);
--> statement-breakpoint
CREATE TABLE `enrolment_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`email` text NOT NULL,
	`facilitator_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enrolment_links_token_unique` ON `enrolment_links` (`token`);--> statement-breakpoint
CREATE TABLE `entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`agenda_item_id` integer,
	`kind` text NOT NULL,
	`visibility` text DEFAULT 'all' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`author_seat_id` integer,
	`current_version` integer DEFAULT 1 NOT NULL,
	`condition_text` text,
	`released` integer DEFAULT 0 NOT NULL,
	`redaction_checked` integer DEFAULT 0 NOT NULL,
	`approved_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `entry_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_id` integer NOT NULL,
	`version` integer NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `facilitator_applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`affiliation` text,
	`email` text NOT NULL,
	`country` text NOT NULL,
	`experience` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer
);
--> statement-breakpoint
CREATE TABLE `facilitators` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `facilitators_email_unique` ON `facilitators` (`email`);--> statement-breakpoint
CREATE TABLE `followups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`series_key` text,
	`type` text NOT NULL,
	`text` text NOT NULL,
	`owner_seat_id` integer,
	`owner_label` text NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'open' NOT NULL,
	`outcome` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`role` text,
	`attestation` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_unique` ON `invites` (`token`);--> statement-breakpoint
CREATE TABLE `login_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`code` text NOT NULL,
	`role` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `platform_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`org_name` text DEFAULT 'Aperture' NOT NULL,
	`default_turn_minutes` integer DEFAULT 7 NOT NULL,
	`require_role_proofs_default` integer DEFAULT 0 NOT NULL,
	`closed_room_retention_days` integer DEFAULT 30 NOT NULL,
	`guest_session_retention_days` integer DEFAULT 3 NOT NULL,
	`application_retention_days` integer DEFAULT 90 NOT NULL,
	`sealed_ledger_kept` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`purpose` text,
	`facilitator_id` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`anonymity_mode` text DEFAULT 'anonymous' NOT NULL,
	`turn_minutes` integer DEFAULT 7 NOT NULL,
	`expires_at` integer NOT NULL,
	`requires_role_proof` integer DEFAULT 0 NOT NULL,
	`chatham_house` integer DEFAULT 1 NOT NULL,
	`next_step_review` integer DEFAULT 0 NOT NULL,
	`retention_days` integer,
	`series_key` text,
	`floor_state` text DEFAULT 'idle' NOT NULL,
	`floor_seat_id` integer,
	`floor_ends_at` integer,
	`turn_number` integer DEFAULT 0 NOT NULL,
	`stage` text DEFAULT 'opening' NOT NULL,
	`stage_ends_at` integer,
	`input_locked` integer DEFAULT 0 NOT NULL,
	`caucus_seat_id` integer,
	`session_at` text,
	`fingerprint` text,
	`sealed_at` integer,
	`chain_head` text,
	`destruction_cert` text,
	`attest_pubs` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_code_unique` ON `rooms` (`code`);--> statement-breakpoint
CREATE TABLE `seats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`token` text NOT NULL,
	`pseudonym` text NOT NULL,
	`real_name` text,
	`use_real_name` integer DEFAULT 0 NOT NULL,
	`claimed_role` text NOT NULL,
	`role_proof_verified` integer DEFAULT 0 NOT NULL,
	`attestation` text,
	`recovery_key` text,
	`status` text DEFAULT 'waiting' NOT NULL,
	`joined_at` integer NOT NULL,
	`left_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seats_token_unique` ON `seats` (`token`);--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`detail` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `summary_confirmations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`summary_version_id` integer NOT NULL,
	`seat_id` integer NOT NULL,
	`confirmed` integer DEFAULT 0 NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `summary_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`version` integer NOT NULL,
	`agreements` text DEFAULT '' NOT NULL,
	`open_issues` text DEFAULT '' NOT NULL,
	`next_steps` text DEFAULT '' NOT NULL,
	`disagreements` text DEFAULT '' NOT NULL,
	`deadlines` text DEFAULT '' NOT NULL,
	`locked` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
