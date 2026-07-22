import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  PaginationResponse,
  SafeUserSummary,
  TemporaryPasswordResponse,
} from '@ai-content-os/contracts';
import type { AuthContext, AuthenticatedRequest } from '../../common/auth/auth.types';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { CreateUserDto, UpdateUserDto, UserQueryDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(
    @CurrentUser() actor: AuthContext,
    @Query() query: UserQueryDto,
  ): Promise<PaginationResponse<SafeUserSummary>> {
    return this.users.list(actor, query);
  }

  @Post()
  @ApiOperation({
    summary: 'Créer un utilisateur et retourner son mot de passe temporaire une seule fois',
  })
  create(
    @CurrentUser() actor: AuthContext,
    @Body() input: CreateUserDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<TemporaryPasswordResponse> {
    return this.users.create(actor, input, request);
  }

  @Get(':userId')
  get(
    @CurrentUser() actor: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<SafeUserSummary> {
    return this.users.get(actor, userId);
  }

  @Patch(':userId')
  update(
    @CurrentUser() actor: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() input: UpdateUserDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<SafeUserSummary> {
    return this.users.update(actor, userId, input, request);
  }

  @Post(':userId/deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(
    @CurrentUser() actor: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.users.deactivate(actor, userId, request);
  }

  @Post(':userId/reactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  reactivate(
    @CurrentUser() actor: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.users.reactivate(actor, userId, request);
  }

  @Post(':userId/reset-password')
  resetPassword(
    @CurrentUser() actor: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<TemporaryPasswordResponse> {
    return this.users.resetPassword(actor, userId, request);
  }

  @Post(':userId/revoke-sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeSessions(
    @CurrentUser() actor: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.users.revokeSessions(actor, userId, request);
  }
}
