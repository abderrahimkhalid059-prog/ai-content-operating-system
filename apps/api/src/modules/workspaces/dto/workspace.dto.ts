import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { WorkspaceRole } from '@ai-content-os/database';

export class CreateWorkspaceDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;
}

export class UpdateWorkspaceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug?: string;
}

export class AddMemberDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ enum: WorkspaceRole, default: WorkspaceRole.VIEWER })
  @IsEnum(WorkspaceRole)
  role: WorkspaceRole = WorkspaceRole.VIEWER;
}

export class UpdateMemberDto {
  @ApiProperty({ enum: WorkspaceRole })
  @IsEnum(WorkspaceRole)
  role!: WorkspaceRole;
}
