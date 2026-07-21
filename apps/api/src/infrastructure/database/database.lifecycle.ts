import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '@ai-content-os/database';

@Injectable()
export class DatabaseLifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(private readonly database: DatabaseService) {}
  async onModuleInit(): Promise<void> {
    await this.database.connect();
  }
  async onApplicationShutdown(): Promise<void> {
    await this.database.disconnect();
  }
}
