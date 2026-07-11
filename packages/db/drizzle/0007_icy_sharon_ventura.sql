CREATE TABLE `autopsies` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`title` varchar(255) NOT NULL,
	`status` enum('draft','queued','analyzing','complete','failed') NOT NULL DEFAULT 'draft',
	`pages` json NOT NULL,
	`report` json,
	`error` varchar(512),
	`share_token` varchar(64),
	`rebuilt_project_id` char(26),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `autopsies_id` PRIMARY KEY(`id`),
	CONSTRAINT `autopsies_share_token_uq` UNIQUE(`share_token`)
);
--> statement-breakpoint
CREATE INDEX `autopsies_ws_idx` ON `autopsies` (`workspace_id`);