export type Actor = {
  id: string;
  name: string;
  phone?: string | null;
  username?: string;
  system?: boolean;
  role: string;
  salesCompanyId: string | null;
  authVersion: number;
};
export const roles = [
  "SUPER_ADMIN",
  "OPERATIONS",
  "FINANCE",
  "SALES_COMPANY_ADMIN",
  "SALES",
] as const;
export const internal = (a: Actor) =>
  ["SUPER_ADMIN", "OPERATIONS", "FINANCE"].includes(a.role);
export const financial = (a: Actor) =>
  ["SUPER_ADMIN", "FINANCE"].includes(a.role);
