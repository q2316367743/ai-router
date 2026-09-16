ALTER TABLE `request_logs` ADD `provider_id` text;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `model_id` text;--> statement-breakpoint
ALTER TABLE `usage_daily` ADD `provider_id` text;--> statement-breakpoint
ALTER TABLE `usage_daily` ADD `model_id` text;--> statement-breakpoint
ALTER TABLE `usage_hourly` ADD `provider_id` text;--> statement-breakpoint
ALTER TABLE `usage_hourly` ADD `model_id` text;