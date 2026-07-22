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
});
