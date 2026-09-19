CREATE TABLE `quota_plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`script` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quota_snapshots` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`snapshot` text,
	`error` text,
	`queried_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `providers` ADD `quota_strategy_id` text;--> statement-breakpoint
ALTER TABLE `providers` ADD `strategy_config` text;