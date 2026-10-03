-- Backfill JSON columns before enforcing NOT NULL (compatible with MySQL 5.7).
ALTER TABLE `orders` ADD COLUMN `depositDeductions` JSON NULL;
UPDATE `orders` SET `depositDeductions` = JSON_ARRAY();
ALTER TABLE `orders` MODIFY COLUMN `depositDeductions` JSON NOT NULL;
ALTER TABLE `incomes` ADD COLUMN `depositOffsetAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0;
ALTER TABLE `expenses` ADD COLUMN `paymentRecords` JSON NULL;
UPDATE `expenses` SET `paymentRecords` = JSON_ARRAY();
ALTER TABLE `expenses` MODIFY COLUMN `paymentRecords` JSON NOT NULL;
