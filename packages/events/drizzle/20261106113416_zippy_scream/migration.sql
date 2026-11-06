CREATE TABLE `daily_usage` (
	`day` text NOT NULL,
	`origin` text NOT NULL,
	`source` text NOT NULL,
	`show_id` text NOT NULL,
	`plays` integer NOT NULL,
	`unique_clients` integer NOT NULL,
	`failures` integer NOT NULL,
	`minutes_watched` real NOT NULL,
	CONSTRAINT `daily_usage_pk` PRIMARY KEY(`day`, `origin`, `source`, `show_id`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`ts` text NOT NULL,
	`kind` text NOT NULL,
	`component` text NOT NULL,
	`outcome` text NOT NULL,
	`play_id` text,
	`source` text,
	`show_id` text,
	`episode_id` text,
	`client` text,
	`status` integer,
	`latency_ms` integer,
	`detail` text
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_ts` ON `events` (`ts`);--> statement-breakpoint
CREATE INDEX `events_kind_ts` ON `events` (`kind`,`ts`);--> statement-breakpoint
CREATE INDEX `events_show` ON `events` (`show_id`);--> statement-breakpoint
CREATE INDEX `events_play` ON `events` (`play_id`);