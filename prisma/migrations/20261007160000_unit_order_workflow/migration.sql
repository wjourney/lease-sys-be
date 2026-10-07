ALTER TABLE `orders` ADD COLUMN `billingVersion` INTEGER NOT NULL DEFAULT 1;
ALTER TABLE `orders` ALTER COLUMN `occupancyState` SET DEFAULT 'OCCUPIED';
UPDATE `orders` SET `occupancyState` = 'OCCUPIED' WHERE `occupancyState` = 'LOCKED';
