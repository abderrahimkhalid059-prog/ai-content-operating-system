import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { WebsitePlatform, WebsiteStatus, WorkspaceRole } from '../src/generated/prisma/enums';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required to seed the database.');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function seed(): Promise<void> {
  const user = await prisma.user.upsert({
    where: { email: 'developer@example.invalid' },
    update: {},
    create: { email: 'developer@example.invalid', displayName: 'Development User' },
  });
  const workspace = await prisma.workspace.upsert({
    where: { slug: 'development-workspace' },
    update: {},
    create: { name: 'Development Workspace', slug: 'development-workspace' },
  });
  await prisma.workspaceMember.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    update: { role: WorkspaceRole.OWNER },
    create: { userId: user.id, workspaceId: workspace.id, role: WorkspaceRole.OWNER },
  });
  await prisma.website.upsert({
    where: { workspaceId_slug: { workspaceId: workspace.id, slug: 'sports-placeholder' } },
    update: {},
    create: {
      workspaceId: workspace.id,
      name: 'Sports Website (Development Placeholder)',
      slug: 'sports-placeholder',
      platform: WebsitePlatform.BLOGGER,
      language: 'ar',
      timezone: 'Africa/Casablanca',
      status: WebsiteStatus.DRAFT,
    },
  });
}

seed()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(
      'Development seed failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    await prisma.$disconnect();
    process.exitCode = 1;
  });
