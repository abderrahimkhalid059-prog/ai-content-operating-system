import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { DatabaseService, WebsitePlatform, WebsiteStatus } from '../src';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('TEST_DATABASE_URL is required for database integration tests.');
const database = new DatabaseService(testUrl);

describe('Workspace and Website relationship', () => {
  afterAll(async () => database.disconnect());

  it('persists a website under its workspace', async () => {
    const suffix = randomUUID();
    const workspace = await database.workspace.create({
      data: { name: 'Integration Workspace', slug: `integration-${suffix}` },
    });
    const website = await database.website.create({
      data: {
        workspaceId: workspace.id,
        name: 'Integration Website',
        slug: 'website',
        platform: WebsitePlatform.OTHER,
        language: 'en',
        timezone: 'UTC',
        status: WebsiteStatus.DRAFT,
      },
      include: { workspace: true },
    });
    expect(website.workspace.id).toBe(workspace.id);
    await database.workspace.delete({ where: { id: workspace.id } });
  });
});
