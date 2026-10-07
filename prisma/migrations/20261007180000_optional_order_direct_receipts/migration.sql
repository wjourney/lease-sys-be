ALTER TABLE `orders`
  MODIFY `projectId` CHAR(36) NULL,
  MODIFY `unitId` CHAR(36) NULL,
  MODIFY `salesCompanyId` CHAR(36) NULL,
  MODIFY `salesUserId` CHAR(36) NULL,
  MODIFY `monthlyRent` DECIMAL(18,2) NULL,
  MODIFY `depositAmount` DECIMAL(18,2) NULL,
  ADD COLUMN `commissionDraft` JSON NULL;
UPDATE `orders` SET `commissionDraft` = JSON_OBJECT() WHERE `commissionDraft` IS NULL;
ALTER TABLE `orders` MODIFY `commissionDraft` JSON NOT NULL;
UPDATE `incomes` SET `status` = 'OPEN' WHERE `recordType` = 'RECEIVABLE' AND `status` = 'PARTIAL';
