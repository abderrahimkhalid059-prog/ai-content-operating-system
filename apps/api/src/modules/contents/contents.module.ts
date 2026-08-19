import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WebsitesModule } from '../websites/websites.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ContentPublicationService } from './content-publication.service';
import { ContentReviewController, ReviewCenterController } from './content-review.controller';
import { ContentReviewService } from './content-review.service';
import { ContentsController } from './contents.controller';
import { ContentsService } from './contents.service';

@Module({
  imports: [AuthModule, WebsitesModule, IntegrationsModule],
  controllers: [ContentsController, ReviewCenterController, ContentReviewController],
  providers: [ContentsService, ContentReviewService, ContentPublicationService],
  exports: [ContentsService],
})
export class ContentsModule {}
