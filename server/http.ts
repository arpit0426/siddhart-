import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { logger } from './logging.js';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }

  static badRequest(message: string, code = 'bad_request') {
    return new ApiError(400, message, code);
  }
  static unauthorized(message = 'Authentication required. Please sign in.') {
    return new ApiError(401, message, 'unauthorized');
  }
  static forbidden(message = 'You do not have permission to access this resource.') {
    return new ApiError(403, message, 'forbidden');
  }
  static notFound(message = 'Resource not found.') {
    return new ApiError(404, message, 'not_found');
  }
  static conflict(message: string, code = 'conflict') {
    return new ApiError(409, message, code);
  }
}

/** Wraps a handler so thrown ApiErrors reach the error middleware. */
export function route(handler: (req: any, res: Response, next: NextFunction) => unknown) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = handler(req as any, res, next);
      if (result && typeof (result as any).catch === 'function') {
        (result as Promise<unknown>).catch(next);
      }
    } catch (error) {
      next(error);
    }
  };
}

export function apiNotFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'API endpoint not found.' });
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const apiError = error instanceof ApiError ? error : null;
  const status = apiError?.status ?? 500;

  if (status >= 500) {
    logger.error('http.error', {
      path: req.path,
      method: req.method,
      message: (error as Error)?.message,
      stack: config.isProduction ? undefined : (error as Error)?.stack,
    });
  } else {
    logger.warn('http.client_error', {
      path: req.path,
      method: req.method,
      status,
      message: (error as Error)?.message,
    });
  }

  if (res.headersSent) return;

  res.status(status).json({
    error:
      apiError?.message ||
      (status >= 500
        ? 'Something went wrong on our side. Please try again.'
        : 'Request could not be processed.'),
    ...(apiError?.code ? { code: apiError.code } : {}),
  });
}
