import type { Permission, WorkspaceRole } from '@ai-content-os/contracts';
import type { RequestWithId } from '../middleware/request-id.middleware';

export interface AuthContext {
  userId: string;
  email: string;
  sessionId: string;
  securityVersion: number;
  mustChangePassword: boolean;
}

export interface WorkspaceContext {
  id: string;
  memberId: string;
  role: WorkspaceRole;
  permissions: Permission[];
}

export interface AuthenticatedRequest extends RequestWithId {
  auth?: AuthContext;
  workspace?: WorkspaceContext;
}
