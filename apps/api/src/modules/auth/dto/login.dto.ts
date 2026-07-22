import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'developer@example.invalid' })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ format: 'password', writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
