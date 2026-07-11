CREATE TABLE `billing_receipts` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`kind` enum('license','subscription','refund') NOT NULL,
	`stripe_ref` varchar(255) NOT NULL,
	`amount_cents` int NOT NULL DEFAULT 0,
	`currency` varchar(8) NOT NULL DEFAULT 'usd',
	`description` varchar(512) NOT NULL,
	`url` varchar(1024),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `billing_receipts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `licenses` ADD `stripe_payment_intent_id` varchar(255);--> statement-breakpoint
CREATE INDEX `billing_receipts_ws_idx` ON `billing_receipts` (`workspace_id`);