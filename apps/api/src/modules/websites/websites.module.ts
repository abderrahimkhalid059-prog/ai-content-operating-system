import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WebsitesController } from './websites.controller';
import { WebsitesService } from './websites.service';

@Module({
  imports: [AuthModule],
  controllers: [WebsitesController],
  providers: [WebsitesService],
  exports: [WebsitesService],
})
export class WebsitesModule {}
