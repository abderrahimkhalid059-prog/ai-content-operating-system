import { afterAll, describe, expect, it } from 'vitest';
import { DatabaseService, WebsitePlatform, WebsiteStatus, WorkspaceRole } from '../src';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('TEST_DATABASE_URL is required for seed integration tests.');
const database = new DatabaseService(testUrl);

describe('Development seed', () => {
  afterAll(async () => database.disconnect());

  it('contains the documented user, workspace membership, and website', async () => {
    const user = await database.user.findUniqueOrThrow({
      where: { email: (process.env.SEED_OWNER_EMAIL ?? 'developer@example.invalid').toLowerCase() },
    });
    const workspace = await database.workspace.findUniqueOrThrow({
      where: { slug: 'development-workspace' },
    });
    const member = await database.workspaceMember.findUniqueOrThrow({
      where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    });
    const website = await database.website.findUniqueOrThrow({
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
    const profile = await database.contentProfile.findUniqueOrThrow({
      where: { websiteId_name: { websiteId: website.id, name: 'Profil éditorial sportif arabe' } },
    });
    expect(profile).toMatchObject({ language: 'ar', isDefault: true, status: 'ACTIVE' });
    expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
  });
});
