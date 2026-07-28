import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BloggerConnectionsService } from './blogger-connections.service';
import { BloggerProviderFactory } from './blogger-provider.factory';
import { BloggerPublicationService } from './blogger-publication.service';
import { BloggerSyncService } from './blogger-sync.service';
import {
  BloggerIntegrationsController,
  PublicIntegrationsController,
} from './integrations.controller';

@Module({
  imports: [AuthModule],
  controllers: [PublicIntegrationsController, BloggerIntegrationsController],
  providers: [
    BloggerProviderFactory,
    BloggerConnectionsService,
    BloggerSyncService,
    BloggerPublicationService,
  ],
  exports: [BloggerProviderFactory],
})
export class IntegrationsModule {}
