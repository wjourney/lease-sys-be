-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "operationLogs" JSONB NOT NULL DEFAULT '[]',
    "deletedAt" TIMESTAMP(3),
    "deletedBy" UUID,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "authVersion" INTEGER NOT NULL DEFAULT 1,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "salesCompanyId" UUID,
    "branchCode" TEXT,
    "positionCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_companies" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "operationLogs" JSONB NOT NULL DEFAULT '[]',
    "deletedAt" TIMESTAMP(3),
    "deletedBy" UUID,
    "companyNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "registrationNo" TEXT,
    "registrationExpiresOn" DATE,
    "serviceStartsOn" DATE,
    "serviceEndsOn" DATE,
    "branches" JSONB NOT NULL DEFAULT '[]',
    "positions" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "sales_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "operationLogs" JSONB NOT NULL DEFAULT '[]',
    "deletedAt" TIMESTAMP(3),
    "deletedBy" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "region" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "propertyName" TEXT,
    "developer" TEXT,
    "completionDate" DATE,
    "longitude" DECIMAL(12,8),
    "latitude" DECIMAL(12,8),
    "description" TEXT,
    "facilities" JSONB NOT NULL DEFAULT '[]',
    "extra" JSONB NOT NULL DEFAULT '{}',
    "salesCanViewExactRent" BOOLEAN NOT NULL DEFAULT false,
    "typeConfigs" JSONB NOT NULL DEFAULT '[]',
    "lessorProfile" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "operationLogs" JSONB NOT NULL DEFAULT '[]',
    "deletedAt" TIMESTAMP(3),
    "deletedBy" UUID,
    "projectId" UUID NOT NULL,
    "unitNo" TEXT NOT NULL,
    "unitTypeCode" TEXT NOT NULL,
    "building" TEXT,
    "floor" TEXT,
    "roomNo" TEXT,
    "area" DECIMAL(12,2) NOT NULL,
    "layout" TEXT,
    "decoration" TEXT,
    "referenceRent" DECIMAL(18,2) NOT NULL,
    "minRent" DECIMAL(18,2) NOT NULL,
    "maxRent" DECIMAL(18,2) NOT NULL,
    "minLeaseMonths" INTEGER NOT NULL DEFAULT 1,
    "commissionNote" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "operationLogs" JSONB NOT NULL DEFAULT '[]',
    "deletedAt" TIMESTAMP(3),
    "deletedBy" UUID,
    "orderNo" TEXT NOT NULL,
    "projectId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "salesCompanyId" UUID NOT NULL,
    "salesUserId" UUID NOT NULL,
    "tenantType" TEXT NOT NULL DEFAULT 'PERSON',
    "tenantName" TEXT NOT NULL,
    "tenantRegistrationNo" TEXT,
    "tenantContactName" TEXT,
    "tenantPhone" TEXT,
    "tenantEmail" TEXT,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "monthlyRent" DECIMAL(18,2) NOT NULL,
    "depositAmount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'HKD',
    "paymentIntervalMonths" INTEGER NOT NULL DEFAULT 1,
    "rentDueDay" INTEGER NOT NULL DEFAULT 1,
    "billLeadDays" INTEGER NOT NULL DEFAULT 7,
    "firstPeriodProration" BOOLEAN NOT NULL DEFAULT true,
    "lastPeriodProration" BOOLEAN NOT NULL DEFAULT true,
    "nextBillOn" DATE,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "firstPaymentRegisteredAt" TIMESTAMP(3),
    "occupancyState" TEXT NOT NULL DEFAULT 'LOCKED',
    "actualTerminationOn" DATE,
    "handoverStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "handedOverAt" TIMESTAMP(3),
    "handoverNote" TEXT,
    "depositDeductionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "depositDeductionReason" TEXT,
    "depositSettledAt" TIMESTAMP(3),
    "tenantSnapshot" JSONB NOT NULL DEFAULT '{}',
    "unitSnapshot" JSONB NOT NULL DEFAULT '{}',
    "salesSnapshot" JSONB NOT NULL DEFAULT '{}',
    "currentContractMaterialId" UUID,
    "remark" TEXT,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incomes" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "operationLogs" JSONB NOT NULL DEFAULT '[]',
    "deletedAt" TIMESTAMP(3),
    "deletedBy" UUID,
    "recordNo" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "parentId" UUID,
    "orderId" UUID,
    "projectId" UUID,
    "unitId" UUID,
    "feeType" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "adjustmentAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'HKD',
    "periodStart" DATE,
    "periodEnd" DATE,
    "dueOn" DATE,
    "receivedOn" DATE,
    "fundAccountId" UUID,
    "paymentMethod" TEXT,
    "bankReference" TEXT,
    "payerName" TEXT,
    "payerEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "confirmedBy" UUID,
    "confirmedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "sourceKey" TEXT,
    "recurrenceRule" JSONB NOT NULL DEFAULT '{}',
    "nextGenerationOn" DATE,
    "remark" TEXT,

    CONSTRAINT "incomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "operationLogs" JSONB NOT NULL DEFAULT '[]',
    "deletedAt" TIMESTAMP(3),
    "deletedBy" UUID,
    "expenseNo" TEXT NOT NULL,
    "orderId" UUID,
    "projectId" UUID,
    "unitId" UUID,
    "commissionId" UUID,
    "originalIncomeId" UUID,
    "feeType" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'HKD',
    "dueOn" DATE,
    "paidOn" DATE,
    "fundAccountId" UUID,
    "paymentMethod" TEXT,
    "bankReference" TEXT,
    "payeeName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "sourceKey" TEXT,
    "remark" TEXT,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "operationLogs" JSONB NOT NULL DEFAULT '[]',
    "deletedAt" TIMESTAMP(3),
    "deletedBy" UUID,
    "commissionNo" TEXT NOT NULL,
    "orderId" UUID NOT NULL,
    "salesCompanyId" UUID NOT NULL,
    "salesUserId" UUID NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'MONTHLY',
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "dueOn" DATE NOT NULL,
    "amount" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'HKD',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "remark" TEXT,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "operationLogs" JSONB NOT NULL DEFAULT '[]',
    "deletedAt" TIMESTAMP(3),
    "deletedBy" UUID,
    "invoiceNo" TEXT NOT NULL,
    "incomeId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'HKD',
    "issuedOn" DATE NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "replacesInvoiceId" UUID,
    "voidReason" TEXT,
    "renderStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "renderAttempts" INTEGER NOT NULL DEFAULT 0,
    "renderError" TEXT,
    "renderNextRetryAt" TIMESTAMP(3),
    "emailTo" TEXT,
    "emailSubject" TEXT,
    "emailStatus" TEXT NOT NULL DEFAULT 'IDLE',
    "emailRequestId" TEXT,
    "emailAttempts" INTEGER NOT NULL DEFAULT 0,
    "emailNextRetryAt" TIMESTAMP(3),
    "emailLastError" TEXT,
    "lastSentAt" TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "operationLogs" JSONB NOT NULL DEFAULT '[]',
    "deletedAt" TIMESTAMP(3),
    "deletedBy" UUID,
    "projectId" UUID,
    "unitId" UUID,
    "orderId" UUID,
    "incomeId" UUID,
    "expenseId" UUID,
    "invoiceId" UUID,
    "salesCompanyId" UUID,
    "userId" UUID,
    "category" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'SHARED',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "body" TEXT,
    "sourceUrl" TEXT,
    "storageKey" TEXT,
    "originalName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "checksum" TEXT,
    "materialGroupId" UUID NOT NULL,
    "versionNo" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "templateMaterialId" UUID,
    "contractSnapshot" JSONB,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fund_accounts" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "operationLogs" JSONB NOT NULL DEFAULT '[]',
    "deletedAt" TIMESTAMP(3),
    "deletedBy" UUID,
    "name" TEXT NOT NULL,
    "bankName" TEXT,
    "accountIdentifier" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'HKD',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "remark" TEXT,

    CONSTRAINT "fund_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "operationLogs" JSONB NOT NULL DEFAULT '[]',
    "deletedAt" TIMESTAMP(3),
    "deletedBy" UUID,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_salesCompanyId_role_idx" ON "users"("salesCompanyId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "sales_companies_companyNo_key" ON "sales_companies"("companyNo");

-- CreateIndex
CREATE UNIQUE INDEX "projects_code_key" ON "projects"("code");

-- CreateIndex
CREATE INDEX "units_projectId_enabled_idx" ON "units"("projectId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "units_projectId_unitNo_key" ON "units"("projectId", "unitNo");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNo_key" ON "orders"("orderNo");

-- CreateIndex
CREATE INDEX "orders_salesCompanyId_salesUserId_status_idx" ON "orders"("salesCompanyId", "salesUserId", "status");

-- CreateIndex
CREATE INDEX "orders_unitId_startsOn_endsOn_idx" ON "orders"("unitId", "startsOn", "endsOn");

-- CreateIndex
CREATE UNIQUE INDEX "incomes_recordNo_key" ON "incomes"("recordNo");

-- CreateIndex
CREATE UNIQUE INDEX "incomes_sourceKey_key" ON "incomes"("sourceKey");

-- CreateIndex
CREATE INDEX "incomes_parentId_status_idx" ON "incomes"("parentId", "status");

-- CreateIndex
CREATE INDEX "incomes_orderId_recordType_idx" ON "incomes"("orderId", "recordType");

-- CreateIndex
CREATE INDEX "incomes_status_dueOn_idx" ON "incomes"("status", "dueOn");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_expenseNo_key" ON "expenses"("expenseNo");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_sourceKey_key" ON "expenses"("sourceKey");

-- CreateIndex
CREATE INDEX "expenses_commissionId_status_idx" ON "expenses"("commissionId", "status");

-- CreateIndex
CREATE INDEX "expenses_orderId_status_idx" ON "expenses"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "commissions_commissionNo_key" ON "commissions"("commissionNo");

-- CreateIndex
CREATE INDEX "commissions_salesCompanyId_salesUserId_idx" ON "commissions"("salesCompanyId", "salesUserId");

-- CreateIndex
CREATE UNIQUE INDEX "commissions_orderId_mode_periodStart_key" ON "commissions"("orderId", "mode", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNo_key" ON "invoices"("invoiceNo");

-- CreateIndex
CREATE INDEX "invoices_incomeId_idx" ON "invoices"("incomeId");

-- CreateIndex
CREATE INDEX "materials_projectId_category_idx" ON "materials"("projectId", "category");

-- CreateIndex
CREATE INDEX "materials_orderId_category_idx" ON "materials"("orderId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "materials_materialGroupId_versionNo_key" ON "materials"("materialGroupId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");


-- Explicit relational and financial invariants.
ALTER TABLE "users" ADD CONSTRAINT "users_salesCompanyId_fk" FOREIGN KEY ("salesCompanyId") REFERENCES "sales_companies"("id") ON DELETE RESTRICT;
ALTER TABLE "units" ADD CONSTRAINT "units_projectId_fk" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT;
ALTER TABLE "orders" ADD CONSTRAINT "orders_projectId_fk" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT;
ALTER TABLE "orders" ADD CONSTRAINT "orders_unitId_fk" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT;
ALTER TABLE "orders" ADD CONSTRAINT "orders_salesCompanyId_fk" FOREIGN KEY ("salesCompanyId") REFERENCES "sales_companies"("id") ON DELETE RESTRICT;
ALTER TABLE "orders" ADD CONSTRAINT "orders_salesUserId_fk" FOREIGN KEY ("salesUserId") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "orders" ADD CONSTRAINT "orders_currentContractMaterialId_fk" FOREIGN KEY ("currentContractMaterialId") REFERENCES "materials"("id") ON DELETE RESTRICT;
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_parentId_fk" FOREIGN KEY ("parentId") REFERENCES "incomes"("id") ON DELETE RESTRICT;
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_orderId_fk" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT;
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_projectId_fk" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT;
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_unitId_fk" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT;
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_fundAccountId_fk" FOREIGN KEY ("fundAccountId") REFERENCES "fund_accounts"("id") ON DELETE RESTRICT;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_orderId_fk" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_projectId_fk" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_unitId_fk" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_commissionId_fk" FOREIGN KEY ("commissionId") REFERENCES "commissions"("id") ON DELETE RESTRICT;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_originalIncomeId_fk" FOREIGN KEY ("originalIncomeId") REFERENCES "incomes"("id") ON DELETE RESTRICT;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_fundAccountId_fk" FOREIGN KEY ("fundAccountId") REFERENCES "fund_accounts"("id") ON DELETE RESTRICT;
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_orderId_fk" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT;
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_salesCompanyId_fk" FOREIGN KEY ("salesCompanyId") REFERENCES "sales_companies"("id") ON DELETE RESTRICT;
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_salesUserId_fk" FOREIGN KEY ("salesUserId") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_incomeId_fk" FOREIGN KEY ("incomeId") REFERENCES "incomes"("id") ON DELETE RESTRICT;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_replacesInvoiceId_fk" FOREIGN KEY ("replacesInvoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT;
ALTER TABLE "materials" ADD CONSTRAINT "materials_projectId_fk" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT;
ALTER TABLE "materials" ADD CONSTRAINT "materials_unitId_fk" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT;
ALTER TABLE "materials" ADD CONSTRAINT "materials_orderId_fk" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT;
ALTER TABLE "materials" ADD CONSTRAINT "materials_incomeId_fk" FOREIGN KEY ("incomeId") REFERENCES "incomes"("id") ON DELETE RESTRICT;
ALTER TABLE "materials" ADD CONSTRAINT "materials_expenseId_fk" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE RESTRICT;
ALTER TABLE "materials" ADD CONSTRAINT "materials_invoiceId_fk" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT;
ALTER TABLE "materials" ADD CONSTRAINT "materials_salesCompanyId_fk" FOREIGN KEY ("salesCompanyId") REFERENCES "sales_companies"("id") ON DELETE RESTRICT;
ALTER TABLE "materials" ADD CONSTRAINT "materials_userId_fk" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "materials" ADD CONSTRAINT "materials_templateMaterialId_fk" FOREIGN KEY ("templateMaterialId") REFERENCES "materials"("id") ON DELETE RESTRICT;

ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('SUPER_ADMIN','OPERATIONS','FINANCE','SALES_COMPANY_ADMIN','SALES'));
ALTER TABLE users ADD CONSTRAINT users_company_check CHECK ((role IN ('SALES_COMPANY_ADMIN','SALES') AND "salesCompanyId" IS NOT NULL) OR (role NOT IN ('SALES_COMPANY_ADMIN','SALES') AND "salesCompanyId" IS NULL));
ALTER TABLE orders ADD CONSTRAINT orders_dates_check CHECK ("startsOn" <= "endsOn");
ALTER TABLE orders ADD CONSTRAINT orders_amount_check CHECK ("monthlyRent">0 AND "depositAmount">=0 AND "depositDeductionAmount">=0);
ALTER TABLE units ADD CONSTRAINT units_amount_check CHECK (area>0 AND "minRent">=0 AND "maxRent">="minRent" AND "referenceRent" BETWEEN "minRent" AND "maxRent");
ALTER TABLE incomes ADD CONSTRAINT income_amount_check CHECK (amount>=0 AND amount+"adjustmentAmount">=0);
ALTER TABLE incomes ADD CONSTRAINT income_shape_check CHECK (("recordType"='RECEIVABLE' AND "parentId" IS NULL AND status IN ('OPEN','PARTIAL','PAID','VOID')) OR ("recordType"='RECEIPT' AND "parentId" IS NOT NULL AND "parentId"<>id AND "orderId" IS NULL AND "projectId" IS NULL AND "unitId" IS NULL AND amount>0 AND "adjustmentAmount"=0 AND "receivedOn" IS NOT NULL AND "fundAccountId" IS NOT NULL AND status IN ('PENDING','CONFIRMED','REJECTED')));
ALTER TABLE expenses ADD CONSTRAINT expense_amount_check CHECK (amount>0 AND "paidAmount">=0 AND ((status='UNPAID' AND "paidAmount"=0 AND "paidOn" IS NULL) OR (status='PAID' AND "paidAmount"=amount AND "paidOn" IS NOT NULL AND "fundAccountId" IS NOT NULL) OR (status='VOID' AND "paidAmount"=0)));
ALTER TABLE commissions ADD CONSTRAINT commission_amount_check CHECK (amount IS NULL OR amount>=0);
ALTER TABLE materials ADD CONSTRAINT material_owner_check CHECK (num_nonnulls("projectId","unitId","orderId","incomeId","expenseId","invoiceId","salesCompanyId","userId")=1);
CREATE UNIQUE INDEX invoices_one_active ON invoices("incomeId") WHERE status='ACTIVE' AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX materials_one_current ON materials("materialGroupId") WHERE "isCurrent"=true AND "deletedAt" IS NULL;
CREATE OR REPLACE FUNCTION verify_income_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_row incomes;
BEGIN
 IF TG_OP='UPDATE' AND (NEW."recordType"<>OLD."recordType" OR NEW."parentId" IS DISTINCT FROM OLD."parentId") THEN RAISE EXCEPTION 'income kind/parent immutable'; END IF;
 IF NEW."recordType"='RECEIPT' THEN
 SELECT * INTO parent_row FROM incomes WHERE id=NEW."parentId";
 IF NOT FOUND OR parent_row."recordType"<>'RECEIVABLE' OR parent_row."deletedAt" IS NOT NULL OR parent_row.currency<>NEW.currency THEN RAISE EXCEPTION 'invalid income parent'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER incomes_validate BEFORE INSERT OR UPDATE ON incomes FOR EACH ROW EXECUTE FUNCTION verify_income_parent();
CREATE OR REPLACE FUNCTION verify_invoice_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt incomes;
BEGIN
 SELECT * INTO receipt FROM incomes WHERE id=NEW."incomeId";
 IF NOT FOUND OR receipt."recordType"<>'RECEIPT' OR receipt.status<>'CONFIRMED' OR receipt."deletedAt" IS NOT NULL OR receipt.amount<>NEW.amount OR receipt.currency<>NEW.currency THEN RAISE EXCEPTION 'invoice requires confirmed matching receipt'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoices_validate BEFORE INSERT OR UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION verify_invoice_receipt();
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE orders ADD CONSTRAINT orders_no_overlap EXCLUDE USING gist ("unitId" WITH =, daterange("startsOn", "endsOn", '[]') WITH &&) WHERE ("deletedAt" IS NULL AND status<>'CLOSED' AND "occupancyState"<>'RELEASED');
