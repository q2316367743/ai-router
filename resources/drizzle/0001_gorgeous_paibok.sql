PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_request_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` text NOT NULL,
	`log_date` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`public_model` text NOT NULL,
	`provider_name` text NOT NULL,
	`upstream_model` text NOT NULL,
	`path` text NOT NULL,
	`status` integer,
	`duration_ms` integer,
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
INSERT INTO `__new_request_logs`("id", "request_id", "log_date", "started_at", "finished_at", "public_model", "provider_name", "upstream_model", "path", "status", "duration_ms", "stream", "prompt_tokens", "completion_tokens", "reasoning_tokens", "cache_read_tokens", "cache_write_tokens", "unrecognized_tokens", "total_tokens", "request_body", "request_headers", "response_body", "response_headers", "error") SELECT "id", "request_id", "log_date", "started_at", "finished_at", "public_model", "provider_name", "upstream_model", "path", "status", "duration_ms", "stream", "prompt_tokens", "completion_tokens", "reasoning_tokens", "cache_read_tokens", "cache_write_tokens", "unrecognized_tokens", "total_tokens", "request_body", "request_headers", "response_body", "response_headers", "error" FROM `request_logs`;--> statement-breakpoint
DROP TABLE `request_logs`;--> statement-breakpoint
ALTER TABLE `__new_request_logs` RENAME TO `request_logs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_request_logs_date` ON `request_logs` (`log_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_request_logs_request_id` ON `request_logs` (`request_id`);