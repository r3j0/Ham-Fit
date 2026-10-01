import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { Prisma } from '../generated/prisma/client.js';

const select = {
  id: true,
  groupId: true,
  requestId: true,
  type: true,
  createdAt: true,
  readAt: true,
} satisfies Prisma.GroupNotificationSelect;
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  async list(userId: string, page: { limit: number; cursor?: string }) {
    const rows = await this.database.groupNotification.findMany({
      where: { userId, ...(page.cursor ? { id: { gt: page.cursor } } : {}) },
      select,
      orderBy: { id: 'asc' },
      take: page.limit + 1,
    });
    const items = rows.slice(0, page.limit);
    return {
      items,
      nextCursor: rows.length > page.limit ? items.at(-1)!.id : null,
    };
  }
  async read(userId: string, id: string) {
    await this.database.groupNotification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    const row = await this.database.groupNotification.findFirst({
      where: { id, userId },
      select,
    });
    if (!row) throw new NotFoundException('알림을 찾을 수 없습니다.');
    return row;
  }
}
