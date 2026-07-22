import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsLocale,
  IsOptional,
  IsString,
  IsTimeZone,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { WebsitePlatform, WebsiteStatus } from '@ai-content-os/database';

export class CreateWebsiteDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(120)
  slug!: string;

  @ApiProperty({ enum: WebsitePlatform })
  @IsEnum(WebsitePlatform)
  platform!: WebsitePlatform;

  @ApiProperty({ example: 'ar' })
  @IsString()
  @Matches(/^[a-z]{2,3}$/i)
  language!: string;

  @ApiPropertyOptional({ example: 'ar-MA' })
  @IsOptional()
  @IsLocale()
  locale?: string;

  @ApiProperty({ example: 'Africa/Casablanca' })
  @IsTimeZone()
  timezone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ enum: WebsiteStatus, default: WebsiteStatus.DRAFT })
  @IsOptional()
  @IsEnum(WebsiteStatus)
  status?: WebsiteStatus;
}

export class UpdateWebsiteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(120)
  slug?: string;

  @ApiPropertyOptional({ enum: WebsitePlatform })
  @IsOptional()
  @IsEnum(WebsitePlatform)
  platform?: WebsitePlatform;

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
  @IsTimeZone()
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ enum: WebsiteStatus })
  @IsOptional()
  @IsEnum(WebsiteStatus)
  status?: WebsiteStatus;
}
