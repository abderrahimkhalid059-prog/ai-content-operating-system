import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HealthResponse } from '@ai-content-os/contracts';
import { HealthService } from './health.service';
import { Public } from '../../common/decorators/auth.decorators';

@ApiTags('health')
@Public()
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'État synthétique de l’application' })
  async summary(): Promise<HealthResponse> {
    return this.health.ready();
  }

  @Get('live')
  @ApiOperation({ summary: 'Sonde de vivacité du processus API' })
  live(): HealthResponse {
    return this.health.live();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Sonde de disponibilité PostgreSQL et Redis' })
  async ready(): Promise<HealthResponse> {
    const result = await this.health.ready();
    if (result.status !== 'ok') throw new ServiceUnavailableException('Le service n’est pas prêt.');
    return result;
  }
}
