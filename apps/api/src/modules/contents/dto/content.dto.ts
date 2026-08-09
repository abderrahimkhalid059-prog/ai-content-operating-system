import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsLocale,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContentEditorialStatus, ContentPublicationStatus } from '@ai-content-os/database';

const optionalUuid = (_object: unknown, value: unknown): boolean =>
  value !== undefined && value !== null;

export class CreateContentDto {
  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  excerpt?: string;

  @ApiProperty({ description: 'HTML éditorial assaini côté serveur.' })
  @IsString()
  @MaxLength(500_000)
  htmlContent!: string;

  @ApiPropertyOptional({ maxLength: 70 })
  @IsOptional()
  @IsString()
  @MaxLength(70)
  metaTitle?: string;

  @ApiPropertyOptional({ maxLength: 180 })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  metaDescription?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_valid_protocol: true })
  @MaxLength(1500)
  canonicalUrl?: string;

  @ApiProperty({ example: 'fr' })
  @Matches(/^[a-z]{2,3}$/i)
  language!: string;

  @ApiPropertyOptional({ example: 'fr-FR' })
  @IsOptional()
  @IsLocale()
  locale?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  featuredImageReference?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 30 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  labels?: string[];

  @ApiPropertyOptional({ enum: [ContentEditorialStatus.IDEA, ContentEditorialStatus.DRAFT] })
  @IsOptional()
  @IsEnum(ContentEditorialStatus)
  editorialStatus?: ContentEditorialStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  contentProfileId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedToUserId?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeReason?: string;
}

export class UpdateContentDto {
  @ApiProperty({ minimum: 1, description: 'Version optimiste chargée par le formulaire.' })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  excerpt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500_000)
  htmlContent?: string;

  @ApiPropertyOptional({ maxLength: 70, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(70)
  metaTitle?: string | null;

  @ApiPropertyOptional({ maxLength: 180, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  metaDescription?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf(optionalUuid)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_valid_protocol: true })
  @MaxLength(1500)
  canonicalUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[a-z]{2,3}$/i)
  language?: string;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf(optionalUuid)
  @IsLocale()
  locale?: string | null;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  featuredImageReference?: string | null;

  @ApiPropertyOptional({ type: [String], maxItems: 30 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  labels?: string[];

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf(optionalUuid)
  @IsUUID()
  contentProfileId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf(optionalUuid)
  @IsUUID()
  assignedToUserId?: string | null;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeReason?: string;
}

export class TransitionContentDto {
  @ApiProperty({ enum: ContentEditorialStatus })
  @IsEnum(ContentEditorialStatus)
  nextStatus!: ContentEditorialStatus;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ArchiveContentDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ListContentsQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ enum: ContentEditorialStatus })
  @IsOptional()
  @IsEnum(ContentEditorialStatus)
  editorialStatus?: ContentEditorialStatus;

  @ApiPropertyOptional({ enum: ContentPublicationStatus })
  @IsOptional()
  @IsEnum(ContentPublicationStatus)
  publicationStatus?: ContentPublicationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  createdBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[a-z]{2,3}$/i)
  language?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  contentProfileId?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  createdTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  updatedFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  updatedTo?: string;
}
