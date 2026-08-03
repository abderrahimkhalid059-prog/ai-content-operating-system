import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class StartBloggerConnectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  redirectAfter?: string;

  @IsOptional()
  @IsBoolean()
  replaceExisting?: boolean;
}

export class BloggerCallbackDto {
  @IsString()
  @MinLength(20)
  @MaxLength(500)
  state!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2_000)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4_096)
  scope?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @IsUrl({ protocols: ['https'], require_protocol: true, require_valid_protocol: true })
  @IsIn(['https://accounts.google.com'])
  iss?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  authuser?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  prompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(253)
  hd?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  error?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_024)
  error_description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_048)
  @IsUrl({ protocols: ['https'], require_protocol: true, require_valid_protocol: true })
  error_uri?: string;
}

export class SelectBloggerSiteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  externalSiteId!: string;
}

export class ProviderPaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  pageToken?: string;
}

export class CreateTestDraftDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100_000)
  htmlContent!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  labels!: string[];

  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,160}$/)
  idempotencyKey!: string;
}

export class UpdateTestDraftDto extends CreateTestDraftDto {}

export class PublicationActionDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,160}$/)
  idempotencyKey!: string;
}
