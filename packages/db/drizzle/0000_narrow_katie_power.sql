CREATE TABLE `api_keys` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`provider` enum('anthropic') NOT NULL DEFAULT 'anthropic',
	`ciphertext` text NOT NULL,
	`iv` varchar(64) NOT NULL,
	`tag` varchar(64) NOT NULL,
	`last4` varchar(8),
	`verified_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_keys_ws_provider_uq` UNIQUE(`workspace_id`,`provider`)
);
--> statement-breakpoint
CREATE TABLE `asset_versions` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`asset_id` char(26) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`blocks` json NOT NULL,
	`wordcount` int NOT NULL DEFAULT 0,
	`readability_grade` decimal(5,2),
	`created_by` enum('system','user','challenger') NOT NULL DEFAULT 'system',
	`prompt_version_id` char(26),
	`meta` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `asset_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `asset_versions_asset_version_uq` UNIQUE(`asset_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`project_id` char(26) NOT NULL,
	`market_id` char(26),
	`type` enum('sales_letter','vsl','short_form_video','webinar','email_sequence','meta_ad','youtube_ad','native_ad','advertorial','upsell','order_bump') NOT NULL,
	`status` enum('draft','council','revising','focus_group','deslop','compliance','packaging','approved','live','retired','blocked') NOT NULL DEFAULT 'draft',
	`control` boolean NOT NULL DEFAULT false,
	`prompt_version_id` char(26),
	`current_version_id` char(26),
	`parent_asset_id` char(26),
	`slug` varchar(128),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `assets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26),
	`actor_user_id` char(26),
	`action` varchar(128) NOT NULL,
	`target_type` varchar(64),
	`target_id` varchar(26),
	`meta` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `calibration_state` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26),
	`adjustments` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `calibration_state_id` PRIMARY KEY(`id`),
	CONSTRAINT `calibration_state_ws_uq` UNIQUE(`workspace_id`)
);
--> statement-breakpoint
CREATE TABLE `challengers` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`control_id` char(26) NOT NULL,
	`asset_id` char(26) NOT NULL,
	`status` enum('queued','live','won','lost') NOT NULL DEFAULT 'queued',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `challengers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `claims` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`asset_id` char(26) NOT NULL,
	`asset_version_id` char(26),
	`text` text NOT NULL,
	`proof_ref` varchar(255),
	`status` enum('proven','flagged') NOT NULL DEFAULT 'flagged',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `claims_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `controls` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`project_id` char(26) NOT NULL,
	`market_id` char(26) NOT NULL,
	`asset_type` enum('sales_letter','vsl','short_form_video','webinar','email_sequence','meta_ad','youtube_ad','native_ad','advertorial','upsell','order_bump') NOT NULL,
	`asset_id` char(26) NOT NULL,
	`since` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `controls_id` PRIMARY KEY(`id`),
	CONSTRAINT `controls_project_market_type_uq` UNIQUE(`project_id`,`market_id`,`asset_type`)
);
--> statement-breakpoint
CREATE TABLE `council_reviews` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`asset_version_id` char(26) NOT NULL,
	`lens` enum('schwartz','halbert','bencivenga','sugarman','kennedy','carlton') NOT NULL,
	`score` int NOT NULL,
	`verdict` enum('pass','revise') NOT NULL,
	`notes` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `council_reviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`project_id` char(26),
	`market_id` char(26),
	`asset_id` char(26),
	`type` enum('page_view','vsl_quartile','quiz_start','quiz_complete','optin','call_start','call_qualified','sale','refund','email_open','email_click') NOT NULL,
	`value` json,
	`session_ref` varchar(64),
	`source` enum('ringba','quiz','pixel','email','manual') NOT NULL,
	`occurred_at` timestamp NOT NULL DEFAULT (now()),
	`dedupe_key` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `events_id` PRIMARY KEY(`id`),
	CONSTRAINT `events_ws_dedupe_uq` UNIQUE(`workspace_id`,`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `exports` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`package_id` char(26),
	`asset_id` char(26),
	`market_id` char(26),
	`format` enum('markdown','html','txt','zip','json') NOT NULL,
	`path` varchar(1024) NOT NULL,
	`checksum` varchar(64),
	`manifest` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `exports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `feature_flags` (
	`id` char(26) NOT NULL,
	`key` varchar(128) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`description` varchar(512),
	`value` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `feature_flags_id` PRIMARY KEY(`id`),
	CONSTRAINT `feature_flags_key_uq` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `focus_group_runs` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`asset_version_id` char(26) NOT NULL,
	`annotations` json NOT NULL,
	`pass` boolean NOT NULL,
	`report` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `focus_group_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `funnel_math_runs` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`project_id` char(26) NOT NULL,
	`inputs` json NOT NULL,
	`outputs` json NOT NULL,
	`pass` boolean NOT NULL,
	`report` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `funnel_math_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gate_reports` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`asset_id` char(26) NOT NULL,
	`gate` enum('G0','G1','G2','G3','G4','G5','G6','G7') NOT NULL,
	`pass` boolean NOT NULL,
	`report` json NOT NULL,
	`overridden_by` char(26),
	`override_reason` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gate_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `genome_components` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26),
	`swipe_id` char(26) NOT NULL,
	`type` enum('lead','mechanism_name','proof_stack','price_reveal','close','bullet_style','headline_pattern') NOT NULL,
	`content` json NOT NULL,
	`tags` json,
	`confidence` decimal(5,4),
	`niche` varchar(128),
	`channel` varchar(64),
	`awareness` enum('unaware','problem','solution','product','most'),
	`is_internal_winner` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `genome_components_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `genome_packs` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26),
	`niche` varchar(128) NOT NULL,
	`name` varchar(255) NOT NULL,
	`definition` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `genome_packs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26),
	`job_id` char(26) NOT NULL,
	`attempt` int NOT NULL DEFAULT 1,
	`status` varchar(32) NOT NULL,
	`worker_id` varchar(64),
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`finished_at` timestamp,
	`error` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `job_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`type` varchar(64) NOT NULL,
	`payload` json NOT NULL,
	`status` enum('pending','claimed','done','failed') NOT NULL DEFAULT 'pending',
	`priority` int NOT NULL DEFAULT 0,
	`run_after` timestamp,
	`attempts` int NOT NULL DEFAULT 0,
	`max_attempts` int NOT NULL DEFAULT 5,
	`claimed_by` varchar(64),
	`heartbeat_at` timestamp,
	`last_error` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `licenses` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`key` varchar(64) NOT NULL,
	`status` enum('active','revoked','expired') NOT NULL DEFAULT 'active',
	`type` enum('standard','beta') NOT NULL DEFAULT 'standard',
	`seats` int NOT NULL DEFAULT 1,
	`expires_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `licenses_id` PRIMARY KEY(`id`),
	CONSTRAINT `licenses_key_uq` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `markets` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`project_id` char(26) NOT NULL,
	`rank` tinyint NOT NULL,
	`label` varchar(255) NOT NULL,
	`schema_version` varchar(16) NOT NULL DEFAULT '1',
	`profile` json NOT NULL,
	`awareness_stage` enum('unaware','problem','solution','product','most'),
	`sophistication` tinyint,
	`resident_emotion` varchar(255),
	`score_total` decimal(8,3),
	`rationale` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `markets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `model_routes` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26),
	`stage` varchar(64) NOT NULL,
	`primary_model` varchar(128) NOT NULL,
	`fallback_chain` json NOT NULL,
	`max_tokens` int,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `model_routes_id` PRIMARY KEY(`id`),
	CONSTRAINT `model_routes_ws_stage_uq` UNIQUE(`workspace_id`,`stage`)
);
--> statement-breakpoint
CREATE TABLE `offers` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`project_id` char(26) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`schema_version` varchar(16) NOT NULL DEFAULT '1',
	`offer` json NOT NULL,
	`approved` boolean NOT NULL DEFAULT false,
	`selected` boolean NOT NULL DEFAULT false,
	`created_by_user_id` char(26),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `offers_id` PRIMARY KEY(`id`),
	CONSTRAINT `offers_project_version_uq` UNIQUE(`project_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `page_build_packages` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`project_id` char(26),
	`market_id` char(26),
	`asset_id` char(26),
	`schema_version` varchar(16) NOT NULL DEFAULT '1',
	`package` json NOT NULL,
	`checksum` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `page_build_packages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `predictions` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`asset_id` char(26) NOT NULL,
	`metric` varchar(64) NOT NULL,
	`predicted` decimal(8,6) NOT NULL,
	`actual` decimal(8,6),
	`brier` decimal(8,6),
	`band` json,
	`resolved_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `predictions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_profiles` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`project_id` char(26) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`schema_version` varchar(16) NOT NULL DEFAULT '1',
	`profile` json NOT NULL,
	`is_current` boolean NOT NULL DEFAULT true,
	`created_by_user_id` char(26),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_profiles_project_version_uq` UNIQUE(`project_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`name` varchar(255) NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'intake',
	`current_profile_id` char(26),
	`current_offer_id` char(26),
	`created_by_user_id` char(26),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prompt_versions` (
	`id` char(26) NOT NULL,
	`name` varchar(128) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`body` text NOT NULL,
	`description` varchar(512),
	`active` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `prompt_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `prompt_versions_name_version_uq` UNIQUE(`name`,`version`)
);
--> statement-breakpoint
CREATE TABLE `quiz_answers` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`session_id` char(26) NOT NULL,
	`question_id` varchar(64) NOT NULL,
	`answer` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `quiz_answers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quiz_definitions` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`project_id` char(26) NOT NULL,
	`slug` varchar(128) NOT NULL,
	`questions` json NOT NULL,
	`scoring` json NOT NULL,
	`bands` json NOT NULL,
	`webhook_url` varchar(1024),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `quiz_definitions_id` PRIMARY KEY(`id`),
	CONSTRAINT `quiz_definitions_slug_uq` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `quiz_leads` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`session_id` char(26),
	`quiz_definition_id` char(26),
	`band` varchar(64),
	`market_id` char(26),
	`contact` json,
	`disqualified` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `quiz_leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quiz_sessions` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`quiz_definition_id` char(26) NOT NULL,
	`session_ref` varchar(64) NOT NULL,
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`completed_at` timestamp,
	`meta` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `quiz_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `quiz_sessions_ref_uq` UNIQUE(`session_ref`)
);
--> statement-breakpoint
CREATE TABLE `seat_assignments` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`license_id` char(26) NOT NULL,
	`user_id` char(26) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `seat_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `seat_assignments_license_user_uq` UNIQUE(`license_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `stripe_events` (
	`id` char(26) NOT NULL,
	`stripe_event_id` varchar(255) NOT NULL,
	`type` varchar(128) NOT NULL,
	`payload` json NOT NULL,
	`processed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `stripe_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `stripe_events_event_uq` UNIQUE(`stripe_event_id`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`stripe_subscription_id` varchar(255),
	`genome_feed` boolean NOT NULL DEFAULT false,
	`status` varchar(32) NOT NULL DEFAULT 'inactive',
	`current_period_end` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `swipes` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26),
	`raw_source` text NOT NULL,
	`niche` varchar(128),
	`channel` varchar(64),
	`first_seen` timestamp,
	`last_seen` timestamp,
	`days_running` int,
	`tags` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `swipes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `usage_ledger` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`project_id` char(26),
	`job_id` char(26),
	`stage` varchar(64),
	`model` varchar(128) NOT NULL,
	`input_tokens` int NOT NULL DEFAULT 0,
	`cache_read_tokens` int NOT NULL DEFAULT 0,
	`output_tokens` int NOT NULL DEFAULT 0,
	`cost_est_usd` decimal(12,6) NOT NULL DEFAULT '0',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `usage_ledger_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` char(26) NOT NULL,
	`email` varchar(320) NOT NULL,
	`name` varchar(255),
	`is_platform_admin` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_uq` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `utm_variant_maps` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`project_id` char(26),
	`asset_id` char(26),
	`utm_content` varchar(255),
	`utm_campaign` varchar(255),
	`headline_variant` json,
	`lead_variant` json,
	`variant_of_asset_id` char(26),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `utm_variant_maps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `voc_phrases` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`market_id` char(26) NOT NULL,
	`phrase` text NOT NULL,
	`kind` enum('pain','desire','objection','identity') NOT NULL,
	`source_ref` char(26),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `voc_phrases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `voc_sources` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`project_id` char(26) NOT NULL,
	`market_id` char(26),
	`kind` varchar(16) NOT NULL,
	`ref` text,
	`raw_content` text,
	`fetched_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `voc_sources_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`id` char(26) NOT NULL,
	`workspace_id` char(26) NOT NULL,
	`user_id` char(26) NOT NULL,
	`role` enum('owner','member') NOT NULL DEFAULT 'member',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workspace_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `workspace_members_ws_user_uq` UNIQUE(`workspace_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` char(26) NOT NULL,
	`name` varchar(255) NOT NULL,
	`owner_user_id` char(26) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workspaces_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `asset_versions_ws_asset_idx` ON `asset_versions` (`workspace_id`,`asset_id`);--> statement-breakpoint
CREATE INDEX `assets_ws_project_idx` ON `assets` (`workspace_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `assets_ws_market_idx` ON `assets` (`workspace_id`,`market_id`);--> statement-breakpoint
CREATE INDEX `audit_log_ws_created_idx` ON `audit_log` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `challengers_ws_control_idx` ON `challengers` (`workspace_id`,`control_id`);--> statement-breakpoint
CREATE INDEX `claims_ws_asset_idx` ON `claims` (`workspace_id`,`asset_id`);--> statement-breakpoint
CREATE INDEX `controls_ws_idx` ON `controls` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `council_reviews_ws_version_idx` ON `council_reviews` (`workspace_id`,`asset_version_id`);--> statement-breakpoint
CREATE INDEX `events_ws_project_occurred_idx` ON `events` (`workspace_id`,`project_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `events_ws_market_idx` ON `events` (`workspace_id`,`market_id`);--> statement-breakpoint
CREATE INDEX `exports_ws_idx` ON `exports` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `focus_group_runs_ws_version_idx` ON `focus_group_runs` (`workspace_id`,`asset_version_id`);--> statement-breakpoint
CREATE INDEX `funnel_math_runs_ws_project_idx` ON `funnel_math_runs` (`workspace_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `gate_reports_ws_asset_gate_idx` ON `gate_reports` (`workspace_id`,`asset_id`,`gate`);--> statement-breakpoint
CREATE INDEX `genome_components_type_niche_idx` ON `genome_components` (`type`,`niche`);--> statement-breakpoint
CREATE INDEX `genome_components_ws_idx` ON `genome_components` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `genome_components_swipe_idx` ON `genome_components` (`swipe_id`);--> statement-breakpoint
CREATE INDEX `genome_packs_niche_idx` ON `genome_packs` (`niche`);--> statement-breakpoint
CREATE INDEX `job_runs_job_idx` ON `job_runs` (`job_id`);--> statement-breakpoint
CREATE INDEX `jobs_status_runafter_idx` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE INDEX `jobs_ws_status_idx` ON `jobs` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `jobs_claimedby_heartbeat_idx` ON `jobs` (`claimed_by`,`heartbeat_at`);--> statement-breakpoint
CREATE INDEX `licenses_workspace_idx` ON `licenses` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `markets_ws_project_idx` ON `markets` (`workspace_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `offers_ws_project_idx` ON `offers` (`workspace_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `page_build_packages_ws_asset_idx` ON `page_build_packages` (`workspace_id`,`asset_id`);--> statement-breakpoint
CREATE INDEX `predictions_ws_asset_idx` ON `predictions` (`workspace_id`,`asset_id`);--> statement-breakpoint
CREATE INDEX `product_profiles_ws_project_idx` ON `product_profiles` (`workspace_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `projects_ws_created_idx` ON `projects` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `prompt_versions_name_active_idx` ON `prompt_versions` (`name`,`active`);--> statement-breakpoint
CREATE INDEX `quiz_answers_session_idx` ON `quiz_answers` (`session_id`);--> statement-breakpoint
CREATE INDEX `quiz_definitions_ws_project_idx` ON `quiz_definitions` (`workspace_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `quiz_leads_ws_idx` ON `quiz_leads` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `quiz_sessions_ws_def_idx` ON `quiz_sessions` (`workspace_id`,`quiz_definition_id`);--> statement-breakpoint
CREATE INDEX `seat_assignments_ws_idx` ON `seat_assignments` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_ws_idx` ON `subscriptions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `swipes_ws_idx` ON `swipes` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `swipes_niche_idx` ON `swipes` (`niche`);--> statement-breakpoint
CREATE INDEX `usage_ledger_ws_created_idx` ON `usage_ledger` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_ledger_ws_project_idx` ON `usage_ledger` (`workspace_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `utm_variant_maps_ws_idx` ON `utm_variant_maps` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `voc_phrases_ws_market_idx` ON `voc_phrases` (`workspace_id`,`market_id`);--> statement-breakpoint
CREATE INDEX `voc_sources_ws_project_idx` ON `voc_sources` (`workspace_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `workspace_members_user_idx` ON `workspace_members` (`user_id`);