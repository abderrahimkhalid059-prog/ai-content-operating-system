import { PrismaPg } from '@prisma/adapter-pg';
import { hash, verify, argon2id } from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  ContentProfileStatus,
  IntegrationMode,
  PublishingProviderType,
  UserStatus,
  WebsiteConnectionStatus,
  WebsitePlatform,
  WebsiteStatus,
  WorkspaceRole,
} from '../src/generated/prisma/enums';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required to seed the database.');
if (process.env.NODE_ENV === 'production') {
  throw new Error('The development seed is disabled in production.');
}

const ownerEmail = (process.env.SEED_OWNER_EMAIL ?? 'developer@example.invalid')
  .trim()
  .toLowerCase();
const ownerPassword = process.env.SEED_OWNER_PASSWORD;
const passwordMinimum = Math.max(12, Number(process.env.PASSWORD_MIN_LENGTH ?? 12));
if (!ownerPassword) throw new Error('SEED_OWNER_PASSWORD is required to seed the database.');
if (
  ownerPassword.length < passwordMinimum ||
  !/[A-Za-z]/.test(ownerPassword) ||
  !/\d/.test(ownerPassword)
) {
  throw new Error(
    `SEED_OWNER_PASSWORD must contain at least ${passwordMinimum} characters, a letter, and a number.`,
  );
}
const seedOwnerPassword: string = ownerPassword;

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function seed(): Promise<void> {
  const existingUser = await prisma.user.findUnique({ where: { email: ownerEmail } });
  const passwordAlreadyMatches =
    existingUser?.passwordHash.startsWith('$argon2id$') === true &&
    (await verify(existingUser.passwordHash, seedOwnerPassword));
  const passwordHash = passwordAlreadyMatches
    ? existingUser.passwordHash
    : await hash(seedOwnerPassword, {
        type: argon2id,
        memoryCost: 65_536,
        timeCost: 3,
        parallelism: 1,
      });
  const user = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {
      ...(passwordAlreadyMatches ? {} : { passwordHash, passwordChangedAt: new Date() }),
      mustChangePassword: false,
      status: UserStatus.ACTIVE,
    },
    create: {
      email: ownerEmail,
      displayName: 'Development Owner',
      passwordHash,
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      status: UserStatus.ACTIVE,
    },
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
  const website = await prisma.website.upsert({
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
  await prisma.$transaction(async (transaction) => {
    await transaction.contentProfile.updateMany({
      where: { websiteId: website.id, isDefault: true },
      data: { isDefault: false },
    });
    await transaction.contentProfile.upsert({
      where: {
        websiteId_name: {
          websiteId: website.id,
          name: 'Profil éditorial sportif arabe',
        },
      },
      update: { isDefault: true, status: ContentProfileStatus.ACTIVE },
      create: {
        workspaceId: workspace.id,
        websiteId: website.id,
        name: 'Profil éditorial sportif arabe',
        language: 'ar',
        locale: 'ar-MA',
        countryCode: 'MA',
        tone: 'Journalisme sportif professionnel',
        targetAudience: 'Lecteurs marocains intéressés par le football',
        editorialRules: {
          attributionRequired: true,
          factualTone: true,
          developmentOnly: true,
        },
        prohibitedTopics: [],
        isDefault: true,
        status: ContentProfileStatus.ACTIVE,
      },
    });
  });
  if ((process.env.SEED_MOCK_BLOGGER_CONNECTION ?? 'false').toLowerCase() === 'true') {
    const existingConnection = await prisma.websiteConnection.findFirst({
      where: {
        workspaceId: workspace.id,
        websiteId: website.id,
        provider: PublishingProviderType.BLOGGER,
        revokedAt: null,
      },
    });
    const data = {
      mode: IntegrationMode.MOCK,
      status: WebsiteConnectionStatus.CONNECTED,
      externalAccountId: 'mock-google-account-001',
      externalSiteId: 'mock-blog-sports-001',
      externalSiteName: 'Blog sportif de démonstration',
      externalSiteUrl: 'https://sports-mock.example.test',
      grantedScopes: ['mock:blogger'],
      connectedAt: new Date(),
      metadata: { accountEmail: 'mock.blogger@example.test', seeded: true },
    };
    if (existingConnection) {
      await prisma.websiteConnection.update({ where: { id: existingConnection.id }, data });
    } else {
      await prisma.websiteConnection.create({
        data: {
          workspaceId: workspace.id,
          websiteId: website.id,
          provider: PublishingProviderType.BLOGGER,
          connectedByUserId: user.id,
          ...data,
        },
      });
    }
  }
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
