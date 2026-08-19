import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContentEditorialStatus, ContentReviewDecision } from '@ai-content-os/database';

export class CreateContentCommentDto {
  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  @Matches(/^[^<>]*$/u, { message: 'Le commentaire doit contenir uniquement du texte.' })
  message!: string;
}

export class CreateContentReviewDto {
  @ApiProperty({ enum: ContentReviewDecision })
  @IsEnum(ContentReviewDecision)
  decision!: ContentReviewDecision;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  reviewedRevisionNumber!: number;

  @ApiPropertyOptional({ maxLength: 4000 })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(4000)
  @Matches(/^[^<>]*$/u, { message: 'La note doit contenir uniquement du texte.' })
  note?: string;
}

export enum ReviewCenterQueueDto {
  TO_WRITE = 'TO_WRITE',
  IN_REVIEW = 'IN_REVIEW',
  CHANGES_REQUESTED = 'CHANGES_REQUESTED',
  APPROVED = 'APPROVED',
  READY_TO_PUBLISH = 'READY_TO_PUBLISH',
}

export class ReviewCenterQueryDto {
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

  @ApiPropertyOptional({ enum: ReviewCenterQueueDto })
  @IsOptional()
  @IsEnum(ReviewCenterQueueDto)
  queue?: ReviewCenterQueueDto;

  @ApiPropertyOptional({ enum: ContentEditorialStatus })
  @IsOptional()
  @IsEnum(ContentEditorialStatus)
  editorialStatus?: ContentEditorialStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[a-z]{2,3}$/i)
  language?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  createdBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedTo?: string;

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
  updatedFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  updatedTo?: string;
}

export class ContentPublicationActionDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedRevision!: number;

  @ApiProperty({ minLength: 8, maxLength: 160 })
  @IsString()
  @MinLength(8)
  @MaxLength(160)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  idempotencyKey!: string;
}
