import type { Server } from 'node:http';
import { ConflictException, Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { RequestIdMiddleware } from '../src/common/middleware/request-id.middleware';

@Controller('failure')
class FailureController {
  @Get() fail(): never {
    throw new ConflictException('Conflit de test.');
  }
}

@Module({ controllers: [FailureController] })
class TestModule {}

describe('Global error format', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await NestFactory.create(TestModule, { logger: false });
    app.use(new RequestIdMiddleware().use.bind(new RequestIdMiddleware()));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  afterAll(async () => app.close());

  it('returns the standard envelope with request ID', async () => {
    const server = app.getHttpServer() as Server;
    const response = await request(server)
      .get('/failure')
      .set('x-request-id', 'test-request-id')
      .expect(409);
    const body: unknown = response.body;
    expect(body).toMatchObject({
      success: false,
      error: { code: 'CONFLICT', message: 'Conflit de test.', requestId: 'test-request-id' },
      path: '/failure',
    });
    if (typeof body !== 'object' || body === null || !('timestamp' in body)) {
      throw new Error('Error response is missing a timestamp.');
    }
    expect(typeof body.timestamp).toBe('string');
  });
});
