import "dotenv/config";
import { PrismaService as Db } from "../src/database/prisma.service";
import { hashPassword } from "../src/common/auth/password";

const db = new Db();

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Development seed disabled in production");
  if (await db.user.count()) {
    console.log("Seed skipped: database already contains users");
    return;
  }
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 10)
    throw new Error("Set SEED_PASSWORD (10+ characters)");
  await db.user.create({
    data: {
      username: "admin",
      name: "系统管理员",
      role: "SUPER_ADMIN",
      passwordHash: hashPassword(password),
    },
  });
  console.log("Admin account created. Password: configured SEED_PASSWORD");
}

main().finally(() => db.$disconnect());
