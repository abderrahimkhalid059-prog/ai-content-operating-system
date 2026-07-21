import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '@ai-content-os/config';
import { DatabaseService } from '@ai-content-os/database';
import { DatabaseLifecycle } from './database.lifecycle';

@Global()
@Module({
  providers: [
    {
      provide: DatabaseService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentConfig, true>) =>
        new DatabaseService(config.get('DATABASE_URL', { infer: true })),
    },
    DatabaseLifecycle,
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
