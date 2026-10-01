-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` CHAR(36) NULL,
    `updatedBy` CHAR(36) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `operationLogs` JSON NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `deletedBy` CHAR(36) NULL,
    `username` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `authVersion` INTEGER NOT NULL DEFAULT 1,
    `role` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `nameEn` VARCHAR(191) NULL,
    `avatarStorageKey` VARCHAR(191) NULL,
    `avatarMimeType` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `salesCompanyId` CHAR(36) NULL,
    `branchCode` VARCHAR(191) NULL,
    `positionCode` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `expiresAt` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    INDEX `users_salesCompanyId_role_idx`(`salesCompanyId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_companies` (
    `id` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` CHAR(36) NULL,
    `updatedBy` CHAR(36) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `operationLogs` JSON NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `deletedBy` CHAR(36) NULL,
    `companyNo` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `nameEn` VARCHAR(191) NULL,
    `contactName` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `serviceArea` TEXT NULL,
    `registrationNo` VARCHAR(191) NULL,
    `registrationExpiresOn` DATE NULL,
    `serviceStartsOn` DATE NULL,
    `serviceEndsOn` DATE NULL,
    `branches` JSON NOT NULL,
    `positions` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',

    UNIQUE INDEX `sales_companies_companyNo_key`(`companyNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `projects` (
    `id` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` CHAR(36) NULL,
    `updatedBy` CHAR(36) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `operationLogs` JSON NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `deletedBy` CHAR(36) NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `nameEn` VARCHAR(191) NULL,
    `region` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NOT NULL,
    `propertyName` VARCHAR(191) NULL,
    `developer` VARCHAR(191) NULL,
    `completionDate` DATE NULL,
    `longitude` DECIMAL(12, 8) NULL,
    `latitude` DECIMAL(12, 8) NULL,
    `description` TEXT NULL,
    `facilities` JSON NOT NULL,
    `extra` JSON NOT NULL,
    `salesCanViewExactRent` BOOLEAN NOT NULL DEFAULT false,
    `typeConfigs` JSON NOT NULL,
    `lessorProfile` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',

    UNIQUE INDEX `projects_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `units` (
    `id` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` CHAR(36) NULL,
    `updatedBy` CHAR(36) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `operationLogs` JSON NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `deletedBy` CHAR(36) NULL,
    `projectId` CHAR(36) NOT NULL,
    `unitNo` VARCHAR(191) NOT NULL,
    `unitTypeCode` VARCHAR(191) NOT NULL,
    `building` VARCHAR(191) NULL,
    `floor` VARCHAR(191) NULL,
    `roomNo` VARCHAR(191) NULL,
    `area` DECIMAL(12, 2) NOT NULL,
    `layout` VARCHAR(191) NULL,
    `decoration` VARCHAR(191) NULL,
    `referenceRent` DECIMAL(18, 2) NOT NULL,
    `minRent` DECIMAL(18, 2) NOT NULL,
    `maxRent` DECIMAL(18, 2) NOT NULL,
    `minLeaseMonths` INTEGER NOT NULL DEFAULT 1,
    `commissionNote` TEXT NULL,
    `extra` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    INDEX `units_projectId_enabled_idx`(`projectId`, `enabled`),
    UNIQUE INDEX `units_projectId_unitNo_key`(`projectId`, `unitNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `orders` (
    `id` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` CHAR(36) NULL,
    `updatedBy` CHAR(36) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `operationLogs` JSON NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `deletedBy` CHAR(36) NULL,
    `orderNo` VARCHAR(191) NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `unitId` CHAR(36) NOT NULL,
    `salesCompanyId` CHAR(36) NOT NULL,
    `salesUserId` CHAR(36) NOT NULL,
    `tenantType` VARCHAR(191) NOT NULL DEFAULT 'PERSON',
    `tenantName` VARCHAR(191) NOT NULL,
    `tenantRegistrationNo` VARCHAR(191) NULL,
    `tenantContactName` VARCHAR(191) NULL,
    `tenantPhone` VARCHAR(191) NULL,
    `tenantEmail` VARCHAR(191) NULL,
    `startsOn` DATE NOT NULL,
    `endsOn` DATE NOT NULL,
    `monthlyRent` DECIMAL(18, 2) NOT NULL,
    `depositAmount` DECIMAL(18, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'HKD',
    `paymentIntervalMonths` INTEGER NOT NULL DEFAULT 1,
    `rentDueDay` INTEGER NOT NULL DEFAULT 1,
    `billLeadDays` INTEGER NOT NULL DEFAULT 7,
    `firstPeriodProration` BOOLEAN NOT NULL DEFAULT true,
    `lastPeriodProration` BOOLEAN NOT NULL DEFAULT true,
    `nextBillOn` DATE NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `firstPaymentRegisteredAt` DATETIME(3) NULL,
    `occupancyState` VARCHAR(191) NOT NULL DEFAULT 'LOCKED',
    `actualTerminationOn` DATE NULL,
    `handoverStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `handedOverAt` DATETIME(3) NULL,
    `handoverNote` TEXT NULL,
    `depositDeductionAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `depositDeductionReason` TEXT NULL,
    `depositSettledAt` DATETIME(3) NULL,
    `tenantSnapshot` JSON NOT NULL,
    `unitSnapshot` JSON NOT NULL,
    `salesSnapshot` JSON NOT NULL,
    `currentContractMaterialId` CHAR(36) NULL,
    `remark` TEXT NULL,

    UNIQUE INDEX `orders_orderNo_key`(`orderNo`),
    INDEX `orders_salesCompanyId_salesUserId_status_idx`(`salesCompanyId`, `salesUserId`, `status`),
    INDEX `orders_unitId_startsOn_endsOn_idx`(`unitId`, `startsOn`, `endsOn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `incomes` (
    `id` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` CHAR(36) NULL,
    `updatedBy` CHAR(36) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `operationLogs` JSON NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `deletedBy` CHAR(36) NULL,
    `recordNo` VARCHAR(191) NOT NULL,
    `recordType` VARCHAR(191) NOT NULL,
    `parentId` CHAR(36) NULL,
    `orderId` CHAR(36) NULL,
    `projectId` CHAR(36) NULL,
    `unitId` CHAR(36) NULL,
    `feeType` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `adjustmentAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'HKD',
    `periodStart` DATE NULL,
    `periodEnd` DATE NULL,
    `dueOn` DATE NULL,
    `receivedOn` DATE NULL,
    `fundAccountId` CHAR(36) NULL,
    `paymentMethod` VARCHAR(191) NULL,
    `bankReference` VARCHAR(191) NULL,
    `payerName` VARCHAR(191) NULL,
    `payerEmail` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `confirmedBy` CHAR(36) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `rejectionReason` TEXT NULL,
    `sourceKey` VARCHAR(191) NULL,
    `recurrenceRule` JSON NOT NULL,
    `nextGenerationOn` DATE NULL,
    `remark` TEXT NULL,

    UNIQUE INDEX `incomes_recordNo_key`(`recordNo`),
    UNIQUE INDEX `incomes_sourceKey_key`(`sourceKey`),
    INDEX `incomes_parentId_status_idx`(`parentId`, `status`),
    INDEX `incomes_orderId_recordType_idx`(`orderId`, `recordType`),
    INDEX `incomes_status_dueOn_idx`(`status`, `dueOn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `expenses` (
    `id` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` CHAR(36) NULL,
    `updatedBy` CHAR(36) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `operationLogs` JSON NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `deletedBy` CHAR(36) NULL,
    `expenseNo` VARCHAR(191) NOT NULL,
    `orderId` CHAR(36) NULL,
    `projectId` CHAR(36) NULL,
    `unitId` CHAR(36) NULL,
    `commissionId` CHAR(36) NULL,
    `originalIncomeId` CHAR(36) NULL,
    `feeType` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `paidAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'HKD',
    `dueOn` DATE NULL,
    `paidOn` DATE NULL,
    `fundAccountId` CHAR(36) NULL,
    `paymentMethod` VARCHAR(191) NULL,
    `bankReference` VARCHAR(191) NULL,
    `payeeName` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'UNPAID',
    `sourceKey` VARCHAR(191) NULL,
    `remark` TEXT NULL,

    UNIQUE INDEX `expenses_expenseNo_key`(`expenseNo`),
    UNIQUE INDEX `expenses_sourceKey_key`(`sourceKey`),
    INDEX `expenses_commissionId_status_idx`(`commissionId`, `status`),
    INDEX `expenses_orderId_status_idx`(`orderId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `commissions` (
    `id` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` CHAR(36) NULL,
    `updatedBy` CHAR(36) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `operationLogs` JSON NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `deletedBy` CHAR(36) NULL,
    `commissionNo` VARCHAR(191) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `salesCompanyId` CHAR(36) NOT NULL,
    `salesUserId` CHAR(36) NOT NULL,
    `mode` VARCHAR(191) NOT NULL DEFAULT 'MONTHLY',
    `periodStart` DATE NOT NULL,
    `periodEnd` DATE NOT NULL,
    `dueOn` DATE NOT NULL,
    `amount` DECIMAL(18, 2) NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'HKD',
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `remark` TEXT NULL,

    UNIQUE INDEX `commissions_commissionNo_key`(`commissionNo`),
    INDEX `commissions_salesCompanyId_salesUserId_idx`(`salesCompanyId`, `salesUserId`),
    UNIQUE INDEX `commissions_orderId_mode_periodStart_key`(`orderId`, `mode`, `periodStart`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` CHAR(36) NULL,
    `updatedBy` CHAR(36) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `operationLogs` JSON NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `deletedBy` CHAR(36) NULL,
    `invoiceNo` VARCHAR(191) NOT NULL,
    `incomeId` CHAR(36) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'HKD',
    `issuedOn` DATE NOT NULL,
    `snapshot` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `replacesInvoiceId` CHAR(36) NULL,
    `voidReason` TEXT NULL,
    `renderStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `renderAttempts` INTEGER NOT NULL DEFAULT 0,
    `renderError` TEXT NULL,
    `renderNextRetryAt` DATETIME(3) NULL,
    `emailTo` VARCHAR(191) NULL,
    `emailSubject` VARCHAR(191) NULL,
    `emailStatus` VARCHAR(191) NOT NULL DEFAULT 'IDLE',
    `emailRequestId` VARCHAR(191) NULL,
    `emailAttempts` INTEGER NOT NULL DEFAULT 0,
    `emailNextRetryAt` DATETIME(3) NULL,
    `emailLastError` TEXT NULL,
    `lastSentAt` DATETIME(3) NULL,

    UNIQUE INDEX `invoices_invoiceNo_key`(`invoiceNo`),
    INDEX `invoices_incomeId_idx`(`incomeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `materials` (
    `id` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` CHAR(36) NULL,
    `updatedBy` CHAR(36) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `operationLogs` JSON NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `deletedBy` CHAR(36) NULL,
    `projectId` CHAR(36) NULL,
    `unitId` CHAR(36) NULL,
    `orderId` CHAR(36) NULL,
    `incomeId` CHAR(36) NULL,
    `expenseId` CHAR(36) NULL,
    `invoiceId` CHAR(36) NULL,
    `salesCompanyId` CHAR(36) NULL,
    `userId` CHAR(36) NULL,
    `category` VARCHAR(191) NOT NULL,
    `visibility` VARCHAR(191) NOT NULL DEFAULT 'SHARED',
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `body` TEXT NULL,
    `sourceUrl` TEXT NULL,
    `storageKey` VARCHAR(191) NULL,
    `originalName` TEXT NULL,
    `mimeType` VARCHAR(191) NULL,
    `sizeBytes` INTEGER NULL,
    `checksum` VARCHAR(191) NULL,
    `materialGroupId` CHAR(36) NOT NULL,
    `versionNo` INTEGER NOT NULL DEFAULT 1,
    `isCurrent` BOOLEAN NOT NULL DEFAULT true,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `templateMaterialId` CHAR(36) NULL,
    `contractSnapshot` JSON NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidReason` TEXT NULL,

    INDEX `materials_projectId_category_idx`(`projectId`, `category`),
    INDEX `materials_orderId_category_idx`(`orderId`, `category`),
    UNIQUE INDEX `materials_materialGroupId_versionNo_key`(`materialGroupId`, `versionNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fund_accounts` (
    `id` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` CHAR(36) NULL,
    `updatedBy` CHAR(36) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `operationLogs` JSON NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `deletedBy` CHAR(36) NULL,
    `name` VARCHAR(191) NOT NULL,
    `bankName` VARCHAR(191) NULL,
    `accountIdentifier` VARCHAR(191) NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'HKD',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `remark` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_settings` (
    `id` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` CHAR(36) NULL,
    `updatedBy` CHAR(36) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `operationLogs` JSON NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `deletedBy` CHAR(36) NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,

    UNIQUE INDEX `system_settings_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- Keep the relational constraints from the PostgreSQL schema.
ALTER TABLE `users` ADD CONSTRAINT `users_salesCompanyId_fk` FOREIGN KEY (`salesCompanyId`) REFERENCES `sales_companies`(`id`) ON DELETE RESTRICT;
ALTER TABLE `units` ADD CONSTRAINT `units_projectId_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE RESTRICT;
ALTER TABLE `orders` ADD CONSTRAINT `orders_projectId_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE RESTRICT;
ALTER TABLE `orders` ADD CONSTRAINT `orders_unitId_fk` FOREIGN KEY (`unitId`) REFERENCES `units`(`id`) ON DELETE RESTRICT;
ALTER TABLE `orders` ADD CONSTRAINT `orders_salesCompanyId_fk` FOREIGN KEY (`salesCompanyId`) REFERENCES `sales_companies`(`id`) ON DELETE RESTRICT;
ALTER TABLE `orders` ADD CONSTRAINT `orders_salesUserId_fk` FOREIGN KEY (`salesUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT;
ALTER TABLE `orders` ADD CONSTRAINT `orders_currentContractMaterialId_fk` FOREIGN KEY (`currentContractMaterialId`) REFERENCES `materials`(`id`) ON DELETE RESTRICT;
ALTER TABLE `incomes` ADD CONSTRAINT `incomes_parentId_fk` FOREIGN KEY (`parentId`) REFERENCES `incomes`(`id`) ON DELETE RESTRICT;
ALTER TABLE `incomes` ADD CONSTRAINT `incomes_orderId_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT;
ALTER TABLE `incomes` ADD CONSTRAINT `incomes_projectId_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE RESTRICT;
ALTER TABLE `incomes` ADD CONSTRAINT `incomes_unitId_fk` FOREIGN KEY (`unitId`) REFERENCES `units`(`id`) ON DELETE RESTRICT;
ALTER TABLE `incomes` ADD CONSTRAINT `incomes_fundAccountId_fk` FOREIGN KEY (`fundAccountId`) REFERENCES `fund_accounts`(`id`) ON DELETE RESTRICT;
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_orderId_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT;
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_projectId_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE RESTRICT;
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_unitId_fk` FOREIGN KEY (`unitId`) REFERENCES `units`(`id`) ON DELETE RESTRICT;
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_commissionId_fk` FOREIGN KEY (`commissionId`) REFERENCES `commissions`(`id`) ON DELETE RESTRICT;
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_originalIncomeId_fk` FOREIGN KEY (`originalIncomeId`) REFERENCES `incomes`(`id`) ON DELETE RESTRICT;
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_fundAccountId_fk` FOREIGN KEY (`fundAccountId`) REFERENCES `fund_accounts`(`id`) ON DELETE RESTRICT;
ALTER TABLE `commissions` ADD CONSTRAINT `commissions_orderId_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT;
ALTER TABLE `commissions` ADD CONSTRAINT `commissions_salesCompanyId_fk` FOREIGN KEY (`salesCompanyId`) REFERENCES `sales_companies`(`id`) ON DELETE RESTRICT;
ALTER TABLE `commissions` ADD CONSTRAINT `commissions_salesUserId_fk` FOREIGN KEY (`salesUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT;
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_incomeId_fk` FOREIGN KEY (`incomeId`) REFERENCES `incomes`(`id`) ON DELETE RESTRICT;
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_replacesInvoiceId_fk` FOREIGN KEY (`replacesInvoiceId`) REFERENCES `invoices`(`id`) ON DELETE RESTRICT;
ALTER TABLE `materials` ADD CONSTRAINT `materials_projectId_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE RESTRICT;
ALTER TABLE `materials` ADD CONSTRAINT `materials_unitId_fk` FOREIGN KEY (`unitId`) REFERENCES `units`(`id`) ON DELETE RESTRICT;
ALTER TABLE `materials` ADD CONSTRAINT `materials_orderId_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT;
ALTER TABLE `materials` ADD CONSTRAINT `materials_incomeId_fk` FOREIGN KEY (`incomeId`) REFERENCES `incomes`(`id`) ON DELETE RESTRICT;
ALTER TABLE `materials` ADD CONSTRAINT `materials_expenseId_fk` FOREIGN KEY (`expenseId`) REFERENCES `expenses`(`id`) ON DELETE RESTRICT;
ALTER TABLE `materials` ADD CONSTRAINT `materials_invoiceId_fk` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE RESTRICT;
ALTER TABLE `materials` ADD CONSTRAINT `materials_salesCompanyId_fk` FOREIGN KEY (`salesCompanyId`) REFERENCES `sales_companies`(`id`) ON DELETE RESTRICT;
ALTER TABLE `materials` ADD CONSTRAINT `materials_userId_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT;
ALTER TABLE `materials` ADD CONSTRAINT `materials_templateMaterialId_fk` FOREIGN KEY (`templateMaterialId`) REFERENCES `materials`(`id`) ON DELETE RESTRICT;

-- MySQL 5.7 has no partial unique indexes. Generated keys are NULL for
-- historical rows, allowing history while enforcing one active/current row.
ALTER TABLE `invoices`
  ADD COLUMN `activeIncomeId` CHAR(36) GENERATED ALWAYS AS
    (IF(`status` = 'ACTIVE' AND `deletedAt` IS NULL, `incomeId`, NULL)) STORED,
  ADD UNIQUE INDEX `invoices_one_active` (`activeIncomeId`);
ALTER TABLE `materials`
  ADD COLUMN `currentMaterialGroupId` CHAR(36) GENERATED ALWAYS AS
    (IF(`isCurrent` = true AND `deletedAt` IS NULL, `materialGroupId`, NULL)) STORED,
  ADD UNIQUE INDEX `materials_one_current` (`currentMaterialGroupId`);
