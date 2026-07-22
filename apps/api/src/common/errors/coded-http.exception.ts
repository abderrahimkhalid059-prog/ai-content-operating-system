import { HttpException } from '@nestjs/common';

export class CodedHttpException extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message, details: [] }, status);
  }
}
