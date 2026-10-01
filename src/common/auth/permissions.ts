import { delegate } from "../resources/resource-map";
import { Actor, financial } from "./actor";
export const readers: any = {
  SUPER_ADMIN: Object.keys(delegate),
  OPERATIONS: [
    "projects",
    "units",
    "orders",
    "materials",
    "sales-companies",
    "users",
    "incomes",
    "settings",
    "fund-accounts",
  ],
  FINANCE: Object.keys(delegate),
  SALES_COMPANY_ADMIN: [
    "projects",
    "units",
    "orders",
    "incomes",
    "commissions",
    "invoices",
    "materials",
    "users",
    "sales-companies",
    "settings",
    "fund-accounts",
  ],
  SALES: [
    "projects",
    "units",
    "orders",
    "incomes",
    "commissions",
    "invoices",
    "materials",
    "settings",
    "fund-accounts",
    "users",
  ],
};
export const writers: any = {
  SUPER_ADMIN: Object.keys(delegate),
  OPERATIONS: ["projects", "units", "orders", "materials"],
  FINANCE: [
    "incomes",
    "expenses",
    "commissions",
    "invoices",
    "fund-accounts",
    "materials",
  ],
  SALES_COMPANY_ADMIN: ["users", "orders"],
  SALES: ["orders"],
};
export const capabilities = (a: Actor) => ({
  read: readers[a.role] ?? [],
  write: writers[a.role] ?? [],
  finance: financial(a),
  manageOrders: ["SUPER_ADMIN", "OPERATIONS"].includes(a.role),
});
