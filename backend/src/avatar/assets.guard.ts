import { timingSafeEqual } from 'node:crypto';
import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class AvatarManagerGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext) {
    const configured = this.config.get<string>('AVATAR_MANAGER_TOKEN');
    if (!configured)
      throw new ServiceUnavailableException(
        '아바타 관리자 API가 설정되지 않았습니다.',
      );
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.headers['x-avatar-manager-token'];
    // The local Next.js server holds this dedicated credential; browsers never receive it.
    if (
      request.headers.origin !== undefined ||
      typeof token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(token) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(configured))
    ) {
      throw new ForbiddenException('아바타 관리자 인증이 필요합니다.');
    }
    return true;
  }
}
