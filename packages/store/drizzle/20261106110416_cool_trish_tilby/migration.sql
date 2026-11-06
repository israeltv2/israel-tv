CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`at` text NOT NULL,
	`kind` text NOT NULL,
	`origin` text NOT NULL,
	`outcome` text NOT NULL,
	`corr` text,
	`client` text,
	`source` text,
	`series` text,
	`video` text,
	`route` text,
	`status` integer,
	`upstream` text,
	`ms` integer,
	`bytes` integer,
	`segments` integer,
	`reason` text,
	`ext` text
);
--> statement-breakpoint
CREATE INDEX `events_at` ON `events` (`at`);--> statement-breakpoint
CREATE INDEX `events_corr` ON `events` (`corr`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_ext` ON `events` (`ext`);