// PENDING is read compatibility for existing orders, never a new order state.
export const inProgressOrderStatuses: ("PENDING" | "ACTIVE")[] = ["PENDING", "ACTIVE"];
export const orderStatusGroups: Record<string, string[]> = {
  IN_PROGRESS: ["DRAFT", ...inProgressOrderStatuses],
  ENDED: ["COMPLETED", "CLOSED"],
};
export const orderInProgress = (status: string) => inProgressOrderStatuses.includes(status as "PENDING" | "ACTIVE");
