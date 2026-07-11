ALTER TABLE `gate_reports` MODIFY COLUMN `asset_id` char(26);--> statement-breakpoint
ALTER TABLE `gate_reports` ADD `project_id` char(26);--> statement-breakpoint
CREATE INDEX `gate_reports_ws_project_gate_idx` ON `gate_reports` (`workspace_id`,`project_id`,`gate`);