import { describe, expect, it } from 'vitest';
import { permissionsForRole } from '../src/common/auth/permissions';

describe('fixed workspace permissions', () => {
  it('gives Owner full access and prevents Admin workspace deactivation', () => {
    expect(permissionsForRole('OWNER')).toContain('workspace.deactivate');
    expect(permissionsForRole('ADMIN')).not.toContain('workspace.deactivate');
  });

  it('limits Viewer to read-only Phase 1 resources', () => {
    expect(permissionsForRole('VIEWER')).toContain('websites.read');
    expect(permissionsForRole('VIEWER')).not.toContain('websites.create');
  });

  it('applies the fixed Phase 2 integration matrix', () => {
    expect(permissionsForRole('OWNER')).toContain('providerPublishing.delete');
    expect(permissionsForRole('ADMIN')).toContain('integrations.connect');
    expect(permissionsForRole('EDITOR')).toContain('integrations.sync');
    expect(permissionsForRole('EDITOR')).not.toContain('integrations.connect');
    expect(permissionsForRole('REVIEWER')).toContain('externalPosts.read');
    expect(permissionsForRole('SEO_MANAGER')).not.toContain('integrations.sync');
    expect(permissionsForRole('WRITER')).toContain('providerPublishing.createDraft');
    expect(permissionsForRole('VIEWER')).not.toContain('providerPublishing.createDraft');
  });

  it('applies the fixed Phase 3A editorial matrix', () => {
    expect(permissionsForRole('OWNER')).toContain('contents.archive');
    expect(permissionsForRole('EDITOR')).toContain('contents.assign');
    expect(permissionsForRole('REVIEWER')).toContain('contents.transition');
    expect(permissionsForRole('REVIEWER')).not.toContain('contents.update');
    expect(permissionsForRole('SEO_MANAGER')).toContain('contents.seo.update');
    expect(permissionsForRole('SEO_MANAGER')).not.toContain('contents.update');
    expect(permissionsForRole('WRITER')).toContain('contents.create');
    expect(permissionsForRole('VIEWER')).toContain('contents.revisions.read');
    expect(permissionsForRole('VIEWER')).not.toContain('contents.create');
  });
});
