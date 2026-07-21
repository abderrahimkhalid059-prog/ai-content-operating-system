import { afterAll, describe, expect, it } from 'vitest';
import { DatabaseService, WebsitePlatform, WebsiteStatus, WorkspaceRole } from '../src';

const testUrl = process.env.TEST_DATABASE_URL;
const database = testUrl ? new DatabaseService(testUrl) : undefined;

describe.skipIf(!database)('Development seed', () => {
  afterAll(async () => database?.disconnect());

  it('contains the documented user, workspace membership, and website', async () => {
    const user = await database!.user.findUniqueOrThrow({
      where: { email: 'developer@example.invalid' },
    });
    const workspace = await database!.workspace.findUniqueOrThrow({
      where: { slug: 'development-workspace' },
    });
    const member = await database!.workspaceMember.findUniqueOrThrow({
      where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    });
    const website = await database!.website.findUniqueOrThrow({
      where: {
        workspaceId_slug: { workspaceId: workspace.id, slug: 'sports-placeholder' },
      },
    });

    expect(member.role).toBe(WorkspaceRole.OWNER);
    expect(website).toMatchObject({
      platform: WebsitePlatform.BLOGGER,
      language: 'ar',
      timezone: 'Africa/Casablanca',
      status: WebsiteStatus.DRAFT,
    });
  });
});
