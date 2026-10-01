import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../common/auth/password";

const db = new PrismaClient();

async function main() {
  const existingAdmin = await db.user.count({
    where: { role: "SUPER_ADMIN", deletedAt: null },
  });
  if (existingAdmin) {
    console.log("An administrator already exists; initialization skipped.");
    return;
  }
  if (await db.user.count()) {
    throw new Error("Users exist but no active administrator was found; investigate manually.");
  }

  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error("INITIAL_ADMIN_PASSWORD must contain at least 12 characters.");
  }
  await db.user.create({
    data: {
      username: process.env.INITIAL_ADMIN_USERNAME || "admin",
      name: process.env.INITIAL_ADMIN_NAME || "系统管理员",
      role: "SUPER_ADMIN",
      passwordHash: hashPassword(password),
    },
  });
  console.log("Initial administrator created.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
