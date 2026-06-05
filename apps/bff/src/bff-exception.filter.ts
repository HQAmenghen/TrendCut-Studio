import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class BffExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest();
    const response = context.getResponse();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const detail = exception instanceof HttpException ? exception.getResponse() : {};
    const message = typeof detail === 'object' && detail && 'message' in detail
      ? (detail as { message?: unknown }).message
      : exception instanceof Error
        ? exception.message
        : 'Internal server error';
    const code = typeof detail === 'object' && detail && 'code' in detail
      ? String((detail as { code?: unknown }).code)
      : status >= 500 ? 'BFF_INTERNAL_ERROR' : 'BFF_REQUEST_FAILED';

    response.status(status).json({
      success: false,
      code,
      message,
      path: request.url,
      timestamp: new Date().toISOString()
    });
  }
}
