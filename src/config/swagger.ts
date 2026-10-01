import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { z } from "zod";
import { CommissionsSchema } from "../modules/commissions/dto/commissions.schema";
import { ExpensesSchema } from "../modules/expenses/dto/expenses.schema";
import { FundAccountsSchema } from "../modules/fund-accounts/dto/fund-accounts.schema";
import { IncomesSchema } from "../modules/incomes/dto/incomes.schema";
import { MaterialsSchema } from "../modules/materials/dto/materials.schema";
import { OrdersSchema } from "../modules/orders/dto/orders.schema";
import { ProjectsSchema } from "../modules/projects/dto/projects.schema";
import { SalesCompaniesSchema } from "../modules/sales-companies/dto/sales-companies.schema";
import { SettingsSchema } from "../modules/settings/dto/settings.schema";
import { UnitsSchema } from "../modules/units/dto/units.schema";
import { UsersSchema } from "../modules/users/dto/users.schema";
export function setupSwagger(app: any) {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("SUPREME BAY API")
      .setVersion("1.0.0")
      .addCookieAuth("lease_session")
      .build(),
  );
  const schemas = {
    users: UsersSchema,
    "sales-companies": SalesCompaniesSchema,
    projects: ProjectsSchema,
    units: UnitsSchema,
    orders: OrdersSchema,
    incomes: IncomesSchema,
    expenses: ExpensesSchema,
    commissions: CommissionsSchema,
    materials: MaterialsSchema,
    "fund-accounts": FundAccountsSchema,
    settings: SettingsSchema,
  };
  for (const [resource, schema] of Object.entries(schemas)) {
    const model = resource.replaceAll("-", "_");
    document.components ??= {};
    document.components.schemas ??= {};
    document.components.schemas[model] = z.toJSONSchema(schema, {
      io: "input",
    }) as any;
    const operation = document.paths["/api/v1/" + resource]?.post;
    if (operation)
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/" + model },
          },
        },
      };
  }
  SwaggerModule.setup("api/docs", app, document);
}
