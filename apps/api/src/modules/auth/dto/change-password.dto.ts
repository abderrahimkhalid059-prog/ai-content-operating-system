import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ format: 'password', writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ format: 'password', writeOnly: true, minLength: 12 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}
