import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccessTokenGuard } from '../../common/auth/access-token.guard';
import { PermissionGuard } from '../../common/auth/permission.guard';
import { WorkspaceGuard } from '../../common/auth/workspace.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';

@Module({
  imports: [JwtModule.register({ global: true })],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, AccessTokenGuard, WorkspaceGuard, PermissionGuard],
  exports: [AuthService, PasswordService, AccessTokenGuard, WorkspaceGuard, PermissionGuard],
})
export class AuthModule {}
