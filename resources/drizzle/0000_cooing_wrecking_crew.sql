CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`protocol` text DEFAULT 'openai' NOT NULL,
	`base_url` text NOT NULL,
	`api_key` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_providers_name` ON `providers` (`name`);--> statement-breakpoint
CREATE TABLE `models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`public_name` text NOT NULL,
	`upstream_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `models_public_name_unique` ON `models` (`public_name`);--> statement-breakpoint
CREATE INDEX `idx_models_provider` ON `models` (`provider_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `request_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` text NOT NULL,
	`log_date` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	`public_model` text NOT NULL,
	`provider_name` text NOT NULL,
	`upstream_model` text NOT NULL,
	`path` text NOT NULL,
	`status` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`stream` integer DEFAULT false NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`reasoning_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`unrecognized_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`request_body` text,
	`request_headers` text,
	`response_body` text,
	`response_headers` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `idx_request_logs_date` ON `request_logs` (`log_date`);--> statement-breakpoint
CREATE TABLE `usage_daily` (
	`date` text NOT NULL,
	`provider_name` text NOT NULL,
	`public_model` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`reasoning_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`unrecognized_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `provider_name`, `public_model`)
);
--> statement-breakpoint
CREATE TABLE `usage_hourly` (
	`hour_key` text NOT NULL,
	`provider_name` text NOT NULL,
	`public_model` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`reasoning_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`unrecognized_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`hour_key`, `provider_name`, `public_model`)
);
--> statement-breakpoint
CREATE INDEX `idx_usage_hourly_key` ON `usage_hourly` (`hour_key`);