import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { AiConfigurationScope } from '@ai-content-os/database';

export class UpsertAiConfigurationDto {
  @ApiProperty({ enum: AiConfigurationScope })
  @IsEnum(AiConfigurationScope)
  scope!: AiConfigurationScope;

  @ApiPropertyOptional()
  @ValidateIf((value: UpsertAiConfigurationDto) => value.scope !== AiConfigurationScope.WORKSPACE)
  @IsUUID()
  websiteId?: string;

  @ApiPropertyOptional()
  @ValidateIf(
    (value: UpsertAiConfigurationDto) => value.scope === AiConfigurationScope.CONTENT_PROFILE,
  )
  @IsUUID()
  contentProfileId?: string;

  @ApiProperty({ example: 'mock' })
  @IsString()
  @Matches(/^[a-z][a-z0-9._-]{1,79}$/)
  providerKey!: string;

  @ApiProperty({ example: 'mock-v1' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  model!: string;

  @ApiPropertyOptional({ description: 'Write-only provider credential.' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(4096)
  credential?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  removeCredential?: boolean;

  @ApiPropertyOptional({ default: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(120000)
  timeoutMs?: number;

  @ApiPropertyOptional({ default: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  maxRetries?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  maxOutputTokens?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  monthlyTokenLimit?: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  pricingCurrency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  inputCostPerMillionMicros?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  outputCostPerMillionMicros?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class AiScopeQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  websiteId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  contentProfileId?: string;
}

export class AiRunsQueryDto extends AiScopeQueryDto {
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
