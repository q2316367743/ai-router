DROP INDEX `models_public_name_unique`;--> statement-breakpoint
CREATE INDEX `idx_models_public` ON `models` (`public_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_models_channel` ON `models` (`public_name`,`provider_id`);--> statement-breakpoint
ALTER TABLE `request_logs` ADD `retry_trace` text;