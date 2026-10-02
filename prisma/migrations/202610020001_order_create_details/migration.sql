ALTER TABLE `orders`
  ADD COLUMN `registrationNoType` VARCHAR(191) NULL,
  ADD COLUMN `depositPlan` VARCHAR(191) NULL,
  ADD COLUMN `moveInOn` DATE NULL,
  ADD COLUMN `initialPayment` JSON NULL;

UPDATE `orders` SET `initialPayment` = '{}' WHERE `initialPayment` IS NULL;

ALTER TABLE `orders` MODIFY `initialPayment` JSON NOT NULL;
