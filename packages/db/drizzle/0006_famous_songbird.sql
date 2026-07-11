CREATE TABLE `campaign_market_maps` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`project_id` char(26) NOT NULL,
	`campaign` varchar(255) NOT NULL,
	`market_id` char(26) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `campaign_market_maps_id` PRIMARY KEY(`id`),
	CONSTRAINT `campaign_market_maps_project_campaign_uq` UNIQUE(`project_id`,`campaign`)
);
--> statement-breakpoint
CREATE TABLE `event_triage` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`project_id` char(26) NOT NULL,
	`source` enum('ringba','quiz','pixel','email','manual') NOT NULL,
	`payload` json NOT NULL,
	`reason` varchar(512) NOT NULL,
	`status` enum('pending','resolved','discarded') NOT NULL DEFAULT 'pending',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `event_triage_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `ingest_key` varchar(64);--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_ingest_key_uq` UNIQUE(`ingest_key`);--> statement-breakpoint
CREATE INDEX `event_triage_ws_project_status_idx` ON `event_triage` (`workspace_id`,`project_id`,`status`);