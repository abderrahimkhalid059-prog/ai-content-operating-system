import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { IntegrationQueueService } from './integration-queue.service';

@Global()
@Module({
  providers: [QueueService, IntegrationQueueService],
  exports: [QueueService, IntegrationQueueService],
})
export class QueueModule {}
