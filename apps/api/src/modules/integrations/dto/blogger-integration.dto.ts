import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
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
