ALTER TABLE `users` ADD COLUMN `avatarStorageProvider` VARCHAR(191) NOT NULL DEFAULT 'LOCAL';
ALTER TABLE `materials` ADD COLUMN `storageProvider` VARCHAR(191) NOT NULL DEFAULT 'LOCAL';
CREATE TABLE `storage_cleanup` (
  `id` CHAR(36) NOT NULL,
  `storageProvider` VARCHAR(191) NOT NULL,
  `storageKey` VARCHAR(191) NOT NULL,
  `deleteAfter` DATETIME(3) NOT NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `lastError` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `storage_cleanup_storageProvider_storageKey_key` (`storageProvider`, `storageKey`),
  INDEX `storage_cleanup_deleteAfter_idx` (`deleteAfter`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
