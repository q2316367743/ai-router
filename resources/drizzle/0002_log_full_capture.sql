ALTER TABLE `request_logs` ADD `request_id` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `request_logs` ADD `started_at` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `finished_at` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `reasoning_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `cache_read_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `cache_write_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `unrecognized_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `request_body` text;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `request_headers` text;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `response_body` text;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `response_headers` text;