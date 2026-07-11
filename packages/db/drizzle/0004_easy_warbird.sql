CREATE TABLE `harvest_queries` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`niche` varchar(128) NOT NULL,
	`query` json NOT NULL,
	`last_run_at` timestamp,
	`last_result` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `harvest_queries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `harvest_queries_ws_idx` ON `harvest_queries` (`workspace_id`,`niche`);