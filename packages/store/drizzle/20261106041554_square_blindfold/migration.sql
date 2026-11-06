CREATE TABLE `counters` (
	`source` text PRIMARY KEY,
	`next` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `episodes` (
	`seriesId` text NOT NULL,
	`key` text NOT NULL,
	`season` integer NOT NULL,
	`episode` integer NOT NULL,
	`createdAt` text NOT NULL,
	CONSTRAINT `episodes_pk` PRIMARY KEY(`seriesId`, `key`),
	CONSTRAINT `fk_episodes_seriesId_series_id_fk` FOREIGN KEY (`seriesId`) REFERENCES `series`(`id`)
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`kind` text NOT NULL,
	`scope` text NOT NULL,
	`startedAt` text NOT NULL,
	`finishedAt` text,
	`status` text NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`showsOk` integer DEFAULT 0 NOT NULL,
	`showsFailed` integer DEFAULT 0 NOT NULL,
	`newEpisodes` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `seasons` (
	`seriesId` text NOT NULL,
	`key` text NOT NULL,
	`number` integer NOT NULL,
	`kind` text NOT NULL,
	`createdAt` text NOT NULL,
	CONSTRAINT `seasons_pk` PRIMARY KEY(`seriesId`, `key`),
	CONSTRAINT `fk_seasons_seriesId_series_id_fk` FOREIGN KEY (`seriesId`) REFERENCES `series`(`id`)
);
--> statement-breakpoint
CREATE TABLE `series` (
	`id` text PRIMARY KEY,
	`source` text NOT NULL,
	`key` text NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shows` (
	`seriesId` text PRIMARY KEY,
	`source` text NOT NULL,
	`catalog` text NOT NULL,
	`title` text NOT NULL,
	`data` text NOT NULL,
	`latestAirDate` text,
	`latestEpisodeSeenAt` text,
	`lastOkAt` text NOT NULL,
	`lastCheckedAt` text NOT NULL,
	`lastError` text,
	`state` text DEFAULT 'listed' NOT NULL,
	`tmdbId` integer,
	`imdbId` text,
	CONSTRAINT `fk_shows_seriesId_series_id_fk` FOREIGN KEY (`seriesId`) REFERENCES `series`(`id`)
);
--> statement-breakpoint
CREATE TABLE `warnings` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`runId` integer,
	`seriesId` text,
	`code` text NOT NULL,
	`message` text NOT NULL,
	`createdAt` text NOT NULL,
	CONSTRAINT `fk_warnings_runId_runs_id_fk` FOREIGN KEY (`runId`) REFERENCES `runs`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_number` ON `episodes` (`seriesId`,`season`,`episode`);--> statement-breakpoint
CREATE UNIQUE INDEX `seasons_number` ON `seasons` (`seriesId`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `series_source_key` ON `series` (`source`,`key`);--> statement-breakpoint
CREATE INDEX `shows_catalog` ON `shows` (`catalog`);--> statement-breakpoint
CREATE INDEX `warnings_series` ON `warnings` (`seriesId`);