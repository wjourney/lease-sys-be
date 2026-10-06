import { Module } from "@nestjs/common";
import { FinanceModule } from "./modules/finance/finance.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CommissionsModule } from "./modules/commissions/commissions.module";
import { ExpensesModule } from "./modules/expenses/expenses.module";
import { FundAccountsModule } from "./modules/fund-accounts/fund-accounts.module";
import { HealthModule } from "./modules/health/health.module";
import { IncomesModule } from "./modules/incomes/incomes.module";
import { InvoicesModule } from "./modules/invoices/invoices.module";
import { JobsModule } from "./modules/jobs/jobs.module";
import { MaterialsModule } from "./modules/materials/materials.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { ProjectsModule } from "./modules/projects/projects.module";
import { SalesCompaniesModule } from "./modules/sales-companies/sales-companies.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { UnitsModule } from "./modules/units/units.module";
import { UsersModule } from "./modules/users/users.module";
@Module({
  imports: [
    FinanceModule,
    AuthModule,
    HealthModule,
    JobsModule,
    UsersModule,
    SalesCompaniesModule,
    ProjectsModule,
    UnitsModule,
    OrdersModule,
    IncomesModule,
    ExpensesModule,
    CommissionsModule,
    InvoicesModule,
    MaterialsModule,
    FundAccountsModule,
    SettingsModule,
  ],
})
export class AppModule {}
