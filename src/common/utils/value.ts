import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
export const number = (v: any) => new Prisma.Decimal(v ?? 0);
export const plain = (v: any): any => JSON.parse(JSON.stringify(v));
export const id = () => randomUUID();
export const serial = (prefix: string) =>
  `${prefix}${new Date().toISOString().slice(0, 10).replaceAll("-", "")}${randomUUID().slice(0, 8).toUpperCase()}`;
