import { randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
export const hashPassword = (password: string) => {
  const salt = randomUUID();
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
};
export const verifyPassword = (password: string, hash: string) => {
  const [salt, h] = hash.split(":");
  if (!salt || !h) return false;
  const b = Buffer.from(h, "hex");
  return b.length === 64 && timingSafeEqual(b, scryptSync(password, salt, 64));
};
