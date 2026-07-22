import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO31661Alpha2,
  IsLocale,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ContentProfileStatus } from '@ai-content-os/database';

export type EditorialRules = Record<string, string | number | boolean | null>;

export class CreateContentProfileDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @ApiProperty({ example: 'ar' })
  @Matches(/^[a-z]{2,3}$/i)
  language!: string;

  @ApiPropertyOptional({ example: 'ar-MA' })
  @IsOptional()
  @IsLocale()
  locale?: string;

  @ApiPropertyOptional({ example: 'MA' })
  @IsOptional()
  @IsISO31661Alpha2()
  countryCode?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  tone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  targetAudience?: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  editorialRules!: EditorialRules;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  prohibitedTopics?: string[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateContentProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[a-z]{2,3}$/i)
  language?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLocale()
  locale?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO31661Alpha2()
  countryCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  tone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  targetAudience?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  editorialRules?: EditorialRules;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  prohibitedTopics?: string[];

  @ApiPropertyOptional({ enum: ContentProfileStatus })
  @IsOptional()
  @IsEnum(ContentProfileStatus)
  status?: ContentProfileStatus;
}
