import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

export * from './generated/prisma/client';
export * from './generated/prisma/enums';

export class DatabaseService extends PrismaClient {
  constructor(connectionString: string) {
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async connect(): Promise<void> {
    await this.$connect();
  }

  async disconnect(): Promise<void> {
    await this.$disconnect();
  }

  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
