import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { EnvironmentConfig } from '@ai-content-os/config';
import type { JobStatusResponse } from '@ai-content-os/contracts';
import type { RequestWithId } from '../../common/middleware/request-id.middleware';
import { QueueService } from '../../infrastructure/queue/queue.service';
import { Public } from '../../common/decorators/auth.decorators';

@ApiTags('system')
@Public()
@Controller({ path: 'system', version: '1' })
export class SystemController {
  constructor(
    private readonly queue: QueueService,
    private readonly config: ConfigService<EnvironmentConfig, true>,
  ) {}

  @Post('test-job')
  @ApiOperation({ summary: 'Ajoute une tâche de validation (hors production)' })
  enqueue(@Req() request: RequestWithId): Promise<JobStatusResponse> {
    this.ensureNonProduction();
    return this.queue.enqueue(request.requestId);
  }

  @Get('test-job/:jobId')
  @ApiOperation({ summary: 'Consulte une tâche de validation (hors production)' })
  async status(@Param('jobId') jobId: string): Promise<JobStatusResponse> {
    this.ensureNonProduction();
    const job = await this.queue.status(jobId);
    if (!job) throw new NotFoundException('Tâche introuvable.');
    return job;
  }

  private ensureNonProduction(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new ForbiddenException('Cette route est désactivée en production.');
    }
  }
}
