import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WebsitesModule } from '../websites/websites.module';
import { ContentProfilesController } from './content-profiles.controller';
import { ContentProfilesService } from './content-profiles.service';

@Module({
  imports: [AuthModule, WebsitesModule],
  controllers: [ContentProfilesController],
  providers: [ContentProfilesService],
})
export class ContentProfilesModule {}
