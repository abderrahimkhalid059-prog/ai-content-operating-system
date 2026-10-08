import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WebsitesModule } from '../websites/websites.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AiModule } from '../ai/ai.module';
import { ArticleGenerationController } from './article-generation.controller';
import { ArticleGenerationService } from './article-generation.service';
import { ContentPublicationService } from './content-publication.service';
import { ContentReviewController, ReviewCenterController } from './content-review.controller';
import { ContentReviewService } from './content-review.service';
import { ContentsController } from './contents.controller';
import { ContentsService } from './contents.service';

@Module({
  imports: [AuthModule, WebsitesModule, IntegrationsModule, AiModule],
  controllers: [
    ContentsController,
    ReviewCenterController,
    ContentReviewController,
    ArticleGenerationController,
  ],
  providers: [
    ContentsService,
    ContentReviewService,
    ContentPublicationService,
    ArticleGenerationService,
  ],
  exports: [ContentsService],
})
export class ContentsModule {}
