import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WebsitesModule } from '../websites/websites.module';
import { ContentsController } from './contents.controller';
import { ContentsService } from './contents.service';

@Module({
  imports: [AuthModule, WebsitesModule],
  controllers: [ContentsController],
  providers: [ContentsService],
  exports: [ContentsService],
})
export class ContentsModule {}
