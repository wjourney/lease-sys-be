import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({
      transactionOptions: {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
