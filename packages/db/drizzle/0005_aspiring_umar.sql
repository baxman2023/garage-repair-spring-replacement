CREATE TABLE `funnel_build_steps` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`build_id` char(26) NOT NULL,
	`market_id` char(26) NOT NULL,
	`asset_type` enum('sales_letter','vsl','short_form_video','webinar','email_sequence','meta_ad','youtube_ad','native_ad','advertorial','upsell','order_bump') NOT NULL,
	`seq` int NOT NULL,
	`status` enum('pending','running','done','failed','skipped') NOT NULL DEFAULT 'pending',
	`job_id` char(26),
	`asset_ids` json,
	`error` varchar(1024),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `funnel_build_steps_id` PRIMARY KEY(`id`),
	CONSTRAINT `funnel_build_steps_build_seq_uq` UNIQUE(`build_id`,`seq`)
);
--> statement-breakpoint
CREATE TABLE `funnel_builds` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`project_id` char(26) NOT NULL,
	`status` enum('running','done','canceled','failed') NOT NULL DEFAULT 'running',
	`plan` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `funnel_builds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `funnel_build_steps_ws_build_idx` ON `funnel_build_steps` (`workspace_id`,`build_id`);--> statement-breakpoint
CREATE INDEX `funnel_builds_ws_project_idx` ON `funnel_builds` (`workspace_id`,`project_id`);