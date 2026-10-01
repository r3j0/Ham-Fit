import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { GroupsService } from '../src/groups/groups.service.js';
import { configureApp } from '../src/setup-app.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { CurriculaService } from '../src/curricula/curricula.service.js';
import { koreanDay, memberProfiles } from '../src/users/member-profile.js';
import { observeClientQueries } from './helpers/pg-queries.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type Account = { id: string; token: string };
type GroupView = {
  id: string;
  name: string;
  currentMembers: number;
  role: string;
  members: Array<{
    userId: string;
    role: string;
    nickname: string;
    streak: number;
    profileCharacter: {
      characterId: string;
      poseId: string;
      clothingIds: string[];
      revision: number;
    };
  }>;
};
type ApplicationView = { id: string; status: string };
describe('groups and notifications against real PostgreSQL', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let groups: GroupsService;
  let owner: Account;
  let member: Account;
  let other: Account;
  const tag = `groups-${randomUUID()}-`;
  const password = 'group-test-password-2026';
  const ids: string[] = [];
  const definitions: string[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    db = app.get(DatabaseService);
    groups = app.get(GroupsService);
  });
  beforeEach(async () => {
    await db.authRateLimit.deleteMany();
    owner = await register('그룹장');
    member = await register('그룹원');
    other = await register('외부인');
  });
  afterAll(async () => {
    await db?.group.deleteMany({ where: { leaderUserId: { in: ids } } });
    await db?.user.deleteMany({ where: { id: { in: ids } } });
    await db?.workoutCurriculum.deleteMany({
      where: { id: { in: definitions } },
    });
    await app?.close();
  });
  const api = (
    account: Account,
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
  ) =>
    request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${account.token}`)
      .set('X-CSRF-Protection', '1');
  async function register(nickname: string): Promise<Account> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('X-CSRF-Protection', '1')
      .send({ email: `${tag}${randomUUID()}@example.test`, password, nickname })
      .expect(201);
    const body = response.body as {
      user: { id: string };
      access_token: string;
    };
    ids.push(body.user.id);
    return { id: body.user.id, token: body.access_token };
  }
  const create = (maxMembers = 3, account = owner) =>
    groups.create(account.id, randomUUID(), {
      name: '함께 운동',
      description: '그룹 소개',
      maxMembers,
    });
  const code = async (id: string) =>
    (await groups.inviteCode(owner.id, id)).inviteCode;
  const apply = async (id: string, account = member, key = randomUUID()) =>
    groups.apply(account.id, key, await code(id));
  async function join(id: string, account = member) {
    const row = await apply(id, account);
    await groups.decide(owner.id, id, row.id, 'approved');
    return row;
  }
  const detail = async (id: string, account = owner) =>
    (await api(account, 'get', `/groups/${id}`).expect(200)).body as GroupView;
  const notificationCount = (requestId: string) =>
    db.groupNotification.count({ where: { requestId } });

  it('loads all owned groups and safe member profiles in one overview, excluding other groups and departed members', async () => {
    const first = await create();
    await join(first.id);
    await create(3, other);
    const baseline = await observeClientQueries(() =>
      groups.overview(owner.id),
    );
    // The overview is deliberately not truncated at the list API's 50-row page.
    for (let i = 0; i < 50; i++) await create(1);
    const aggregate = await observeClientQueries(() =>
      groups.overview(owner.id),
    );
    expect(aggregate.queries.length).toBe(baseline.queries.length);
    const response = await api(owner, 'get', '/groups/overview').expect(200);
    const overview = response.body as { items: GroupView[] };
    expect(response.headers['cache-control']).toBe('no-store');
    expect(overview.items).toHaveLength(51);
    expect(overview.items.map((g) => g.id)).toEqual(
      overview.items.map((g) => g.id).sort(),
    );
    expect(overview.items.every((g) => g.role === 'leader')).toBe(true);
    const full = overview.items.find((g) => g.id === first.id)!;
    const { role: _role, ...withoutRole } = full;
    expect(withoutRole).toEqual(await detail(first.id));
    expect(full.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: member.id,
          todayWorkoutCompleted: false,
        }),
      ]),
    );
    expect(JSON.stringify(overview)).not.toMatch(
      /email|password|inviteCode|dateOfBirth/,
    );
    const memberView = (
      await api(member, 'get', '/groups/overview').expect(200)
    ).body as { items: GroupView[] };
    expect(memberView.items).toHaveLength(1);
    expect(memberView.items[0].role).toBe('member');
    await groups.leave(member.id, first.id);
    expect(
      (await api(member, 'get', '/groups/overview').expect(200)).body,
    ).toEqual({ items: [] });
    const refreshed = (await api(owner, 'get', '/groups/overview').expect(200))
      .body as { items: GroupView[] };
    expect(
      refreshed.items.find((g) => g.id === first.id)!.members,
    ).toHaveLength(1);
    await request(app.getHttpServer())
      .get('/api/v1/groups/overview')
      .expect(401);
  });

  it('rejects a capacity above five in the API and database and admits only one winner for the fifth place', async () => {
    await api(owner, 'post', '/groups')
      .set('Idempotency-Key', randomUUID())
      .send({ name: '큰 그룹', description: '', maxMembers: 6 })
      .expect(400);
    await expect(create(6)).rejects.toThrow();
    const group = await create(5);
    await join(group.id);
    await join(group.id, other);
    const fourth = await register('네번째');
    await join(group.id, fourth);
    const fifth = await register('다섯번째');
    const sixth = await register('여섯번째');
    const a = await apply(group.id, fifth);
    const b = await apply(group.id, sixth);
    const results = await Promise.allSettled([
      groups.decide(owner.id, group.id, a.id, 'approved'),
      groups.decide(owner.id, group.id, b.id, 'approved'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await detail(group.id)).currentMembers).toBe(5);
    await expect(
      db.group.update({ where: { id: group.id }, data: { maxMembers: 6 } }),
    ).rejects.toThrow();
  });

  it('creates exactly one leader, keeps tokens private, validates input and deduplicates creation', async () => {
    const key = randomUUID();
    const input = { name: '  우리 그룹  ', description: '', maxMembers: 1 };
    const responses = await Promise.all(
      [0, 1].map(() =>
        api(owner, 'post', '/groups')
          .set('Idempotency-Key', key)
          .send(input)
          .expect(201),
      ),
    );
    const group = responses[0].body as GroupView;
    expect(responses[1].body).toEqual(group);
    expect(group).toMatchObject({
      name: '우리 그룹',
      currentMembers: 1,
      role: 'leader',
    });
    const view = await detail(group.id);
    expect(view.members).toEqual([
      expect.objectContaining({
        userId: owner.id,
        role: 'leader',
        nickname: '그룹장',
        profileCharacter: expect.objectContaining({
          characterId: 'character.cream',
          poseId: 'pose.basic',
          clothingIds: [],
        }),
        streak: 0,
      }),
    ]);
    expect(JSON.stringify(view)).not.toMatch(
      /email|password|inviteCode|dateOfBirth/,
    );
    const token = await api(
      owner,
      'get',
      `/groups/${group.id}/invite-code`,
    ).expect(200);
    expect(token.headers['cache-control']).toBe('no-store');
    expect((token.body as { inviteCode: string }).inviteCode).toMatch(
      /^[\w-]{43}$/,
    );
    await api(other, 'get', `/groups/${group.id}/invite-code`).expect(403);
    await api(owner, 'post', '/groups')
      .set('Idempotency-Key', key)
      .send({ ...input, name: '다른 그룹' })
      .expect(409);
    await api(owner, 'post', '/groups').send(input).expect(400);
    await api(owner, 'patch', `/groups/${group.id}`)
      .send({ maxMembers: 10 })
      .expect(400);
    await api(owner, 'patch', `/groups/${group.id}`)
      .send({ name: '변경', description: '새 소개' })
      .expect(200);
    await request(app.getHttpServer()).get('/api/v1/groups').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/groups')
      .set('Authorization', `Bearer ${owner.token}`)
      .send(input)
      .expect(403);
    await api(owner, 'get', '/groups?search=public').expect(400);
  });

  it('requires approval, supports multiple groups, rejects duplicates and unknown codes, and permits reapplication', async () => {
    const first = await create();
    const second = await create();
    const inviteCode = await code(first.id);
    const key = randomUUID();
    const send = (account: Account, requestKey: string, invite = inviteCode) =>
      api(account, 'post', '/groups/join-requests')
        .set('Idempotency-Key', requestKey)
        .send({ inviteCode: invite });
    const pending = (await send(member, key).expect(201))
      .body as ApplicationView;
    expect((await send(member, key).expect(201)).body).toEqual(pending);
    expect(await notificationCount(pending.id)).toBe(1);
    expect((await detail(first.id)).currentMembers).toBe(1);
    await api(member, 'get', `/groups/${first.id}`).expect(403);
    await send(member, randomUUID()).expect(409);
    await send(owner, randomUUID()).expect(409);
    await send(
      other,
      randomUUID(),
      randomBytes(32).toString('base64url'),
    ).expect(404);
    await send(other, randomUUID(), 'invalid').expect(400);
    await groups.decide(owner.id, first.id, pending.id, 'rejected');
    const again = await apply(first.id);
    expect(again.id).not.toBe(pending.id);
    await groups.decide(owner.id, first.id, again.id, 'approved');
    await join(second.id);
    const mine = (await api(member, 'get', '/groups').expect(200)).body as {
      items: GroupView[];
    };
    expect(mine.items.map((row) => row.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    await send(member, randomUUID()).expect(409);
    await groups.kick(owner.id, first.id, member.id);
    await api(member, 'get', `/groups/${first.id}`).expect(403);
    await api(member, 'get', `/groups/${first.id}/members/${owner.id}`).expect(
      403,
    );
    await api(member, 'get', `/groups/${first.id}/invite-code`).expect(403);
    await groups.decide(owner.id, first.id, again.id, 'approved');
    expect(
      await db.groupMembership.count({
        where: { groupId: first.id, userId: member.id },
      }),
    ).toBe(0);
    const third = await apply(first.id);
    expect(third.id).not.toBe(again.id);
    await groups.decide(owner.id, first.id, third.id, 'approved');
    await api(member, 'delete', `/groups/${first.id}/members/me`).expect(204);
    await api(member, 'get', `/groups/${first.id}`).expect(403);
    await detail(second.id, member);
  });

  it('enforces all leader-only routes, group scoping and immediate authority changes', async () => {
    const group = await create();
    await join(group.id);
    const pending = await apply(group.id, other);
    const second = await create();
    const foreign = await apply(second.id, other);
    for (const account of [member, other]) {
      await api(account, 'patch', `/groups/${group.id}`)
        .send({ name: '불가' })
        .expect(403);
      await api(account, 'get', `/groups/${group.id}/join-requests`).expect(
        403,
      );
      await api(
        account,
        'post',
        `/groups/${group.id}/join-requests/${pending.id}/approve`,
      ).expect(403);
      await api(
        account,
        'post',
        `/groups/${group.id}/join-requests/${pending.id}/reject`,
      ).expect(403);
      await api(account, 'post', `/groups/${group.id}/leadership`)
        .send({ userId: member.id })
        .expect(403);
      await api(
        account,
        'delete',
        `/groups/${group.id}/members/${member.id}`,
      ).expect(403);
      await api(account, 'delete', `/groups/${group.id}`).expect(403);
    }
    await api(
      owner,
      'post',
      `/groups/${group.id}/join-requests/${foreign.id}/approve`,
    ).expect(404);
    await api(owner, 'post', `/groups/${group.id}/leadership`)
      .send({ userId: other.id })
      .expect(404);
    await api(
      owner,
      'delete',
      `/groups/${group.id}/members/${owner.id}`,
    ).expect(409);
    await api(owner, 'delete', `/groups/${group.id}/members/me`).expect(409);
    await api(owner, 'post', `/groups/${group.id}/leadership`)
      .send({ userId: member.id })
      .expect(204);
    const view = await detail(group.id);
    expect(
      view.members
        .filter((row) => row.role === 'leader')
        .map((row) => row.userId),
    ).toEqual([member.id]);
    await api(owner, 'patch', `/groups/${group.id}`)
      .send({ name: '불가' })
      .expect(403);
    await api(
      member,
      'post',
      `/groups/${group.id}/join-requests/${pending.id}/reject`,
    ).expect(200);
    await api(owner, 'delete', `/groups/${group.id}/members/me`).expect(204);
    await api(owner, 'get', `/groups/${group.id}`).expect(403);
    await api(member, 'delete', `/groups/${group.id}/members/me`).expect(204);
    expect(await db.group.findUnique({ where: { id: group.id } })).toBeNull();
  });

  it('serializes simultaneous approvals at capacity and identical application decisions', async () => {
    const group = await create(2);
    const a = await apply(group.id);
    const b = await apply(group.id, other);
    const results = await Promise.allSettled([
      groups.decide(owner.id, group.id, a.id, 'approved'),
      groups.decide(owner.id, group.id, b.id, 'approved'),
    ]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect((await detail(group.id)).currentMembers).toBe(2);
    const loser = await db.groupJoinRequest.findFirstOrThrow({
      where: { groupId: group.id, status: 'pending' },
    });
    expect(await notificationCount(loser.id)).toBe(1);
    const winner = await db.groupJoinRequest.findFirstOrThrow({
      where: { groupId: group.id, status: 'approved' },
    });
    await Promise.all(
      Array.from({ length: 8 }, () =>
        groups.decide(owner.id, group.id, winner.id, 'approved'),
      ),
    );
    expect(await notificationCount(winner.id)).toBe(2);
    expect(
      await db.groupMembership.count({
        where: { groupId: group.id, userId: winner.userId },
      }),
    ).toBe(1);
    // Full groups still accept requests; only approval is capacity-gated.
    const solo = await create(1);
    const pending = await apply(solo.id);
    await expect(
      groups.decide(owner.id, solo.id, pending.id, 'approved'),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('serializes same-user submissions with both identical and different request keys', async () => {
    const group = await create();
    const invite = await code(group.id);
    const key = randomUUID();
    const retries = await Promise.all(
      Array.from({ length: 4 }, () => groups.apply(member.id, key, invite)),
    );
    expect(new Set(retries.map((row) => row.id)).size).toBe(1);
    const conflicts = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        groups.apply(other.id, randomUUID(), invite),
      ),
    );
    expect(conflicts.filter((row) => row.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(
      await db.groupJoinRequest.count({ where: { groupId: group.id } }),
    ).toBe(2);
    expect(
      await db.groupNotification.count({ where: { groupId: group.id } }),
    ).toBe(2);
  });

  it('keeps leadership consistent during transfer, leave and approval races', async () => {
    const group = await create();
    await join(group.id);
    const pending = await apply(group.id, other);
    const managementResults = await Promise.allSettled([
      groups.transfer(owner.id, group.id, member.id),
      groups.leave(member.id, group.id),
      groups.decide(owner.id, group.id, pending.id, 'approved'),
    ]);
    expect(
      managementResults.some((result) => result.status === 'fulfilled'),
    ).toBe(true);
    for (const result of managementResults) {
      if (result.status === 'rejected') {
        // Integrity alone is insufficient: database errors must not be hidden by allSettled.
        expect(result.reason).toMatchObject({
          status: expect.toBeOneOf([403, 404, 409]),
        });
      }
    }
    const row = await db.group.findUniqueOrThrow({
      where: { id: group.id },
      include: { members: true },
    });
    expect(row.members.some((entry) => entry.userId === row.leaderUserId)).toBe(
      true,
    );
    expect(row.members.length).toBeLessThanOrEqual(row.maxMembers);
    expect(
      (await detail(group.id)).members.filter(
        (entry) => entry.role === 'leader',
      ),
    ).toHaveLength(1);
    const solo = await create();
    const application = await apply(solo.id);
    const departureResults = await Promise.allSettled([
      groups.leave(owner.id, solo.id),
      groups.decide(owner.id, solo.id, application.id, 'approved'),
    ]);
    expect(
      departureResults.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    for (const result of departureResults) {
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({
          status: expect.toBeOneOf([404, 409]),
        });
    }
    const state = await db.group.findUnique({
      where: { id: solo.id },
      include: { members: true },
    });
    if (state) {
      expect(state.members).toHaveLength(2);
      expect(state.leaderUserId).toBe(owner.id);
    } else
      expect(
        await db.groupJoinRequest.count({ where: { groupId: solo.id } }),
      ).toBe(0);
  });

  it('enforces leader membership and membership uniqueness in PostgreSQL, including rollback', async () => {
    const group = await create();
    await join(group.id);
    await expect(
      db.group.update({
        where: { id: group.id },
        data: { leaderUserId: other.id },
      }),
    ).rejects.toThrow();
    await expect(
      db.groupMembership.delete({
        where: { groupId_userId: { groupId: group.id, userId: owner.id } },
      }),
    ).rejects.toThrow();
    await expect(
      db.groupMembership.create({
        data: { groupId: group.id, userId: member.id },
      }),
    ).rejects.toThrow();
    expect(
      (await detail(group.id)).members.filter((row) => row.role === 'leader'),
    ).toHaveLength(1);
    await api(owner, 'delete', '/users/me').send({ password }).expect(409);
    await detail(group.id);
  });

  it('commits inbox notifications exactly once to the right users and restricts inbox access', async () => {
    const group = await create();
    const pending = await apply(group.id);
    const initial = await db.groupNotification.findMany({
      where: { requestId: pending.id },
    });
    expect(initial).toEqual([
      expect.objectContaining({ userId: owner.id, type: 'join_requested' }),
    ]);
    const decisions = await Promise.allSettled([
      groups.decide(owner.id, group.id, pending.id, 'approved'),
      groups.decide(owner.id, group.id, pending.id, 'rejected'),
    ]);
    expect(decisions.filter((row) => row.status === 'fulfilled')).toHaveLength(
      1,
    );
    const stored = await db.groupJoinRequest.findUniqueOrThrow({
      where: { id: pending.id },
    });
    const outcome = stored.status === 'approved' ? 'approved' : 'rejected';
    await groups.decide(owner.id, group.id, pending.id, outcome);
    const notifications = await db.groupNotification.findMany({
      where: { requestId: pending.id },
    });
    expect(notifications).toHaveLength(2);
    expect(notifications.find((row) => row.userId === member.id)?.type).toBe(
      `join_${outcome}`,
    );
    const inbox = await api(member, 'get', '/notifications').expect(200);
    expect(inbox.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(inbox.body)).not.toMatch(/email|inviteCode/);
    await api(member, 'patch', `/notifications/${initial[0].id}/read`).expect(
      404,
    );
    const first = (
      await api(owner, 'patch', `/notifications/${initial[0].id}/read`).expect(
        200,
      )
    ).body as { readAt: string };
    const retry = (
      await api(owner, 'patch', `/notifications/${initial[0].id}/read`).expect(
        200,
      )
    ).body as { readAt: string };
    expect(first.readAt).toBe(retry.readAt);
  });

  it('rolls approval and application back if durable notification insertion fails', async () => {
    const group = await create();
    const pending = await apply(group.id);
    // A deliberate DB constraint failure exercises the real transaction rollback.
    const schema = new URL(process.env.DATABASE_URL!).searchParams.get(
      'schema',
    )!;
    const table = Prisma.raw(`"${schema}"."group_notifications"`);
    await db.$executeRaw`ALTER TABLE ${table} ADD CONSTRAINT test_notifications_unavailable CHECK (false) NOT VALID`;
    try {
      await expect(
        groups.decide(owner.id, group.id, pending.id, 'approved'),
      ).rejects.toThrow();
      expect(
        await db.groupMembership.count({ where: { groupId: group.id } }),
      ).toBe(1);
      expect(
        (
          await db.groupJoinRequest.findUniqueOrThrow({
            where: { id: pending.id },
          })
        ).status,
      ).toBe('pending');
      expect(await notificationCount(pending.id)).toBe(1);
      await expect(apply(group.id, other)).rejects.toThrow();
      expect(
        await db.groupJoinRequest.count({ where: { groupId: group.id } }),
      ).toBe(1);
    } finally {
      await db.$executeRaw`ALTER TABLE ${table} DROP CONSTRAINT test_notifications_unavailable`;
    }
    await groups.decide(owner.id, group.id, pending.id, 'approved');
    expect(await notificationCount(pending.id)).toBe(2);
  });

  it('deletes only the selected group and its requests, memberships, inbox and replay records', async () => {
    const group = await create();
    const kept = await create();
    await join(group.id);
    await join(kept.id);
    await apply(group.id, other);
    const definition = await db.workoutCurriculum.create({
      data: { name: '[TEST ONLY] retained personal mission' },
    });
    definitions.push(definition.id);
    const curricula = app.get(CurriculaService);
    const assigned = await curricula.assign(
      member.id,
      definition.id,
      randomUUID(),
    );
    await curricula.complete(member.id, assigned.id);
    await db.userCurrency.update({
      where: { userId: member.id },
      data: { balance: 7 },
    });
    const personal = await db.user.findMany({
      where: { id: { in: [owner.id, member.id] } },
      include: {
        currency: true,
        preference: true,
        sessions: true,
        curriculumAssignments: true,
        workoutRoutines: true,
      },
    });
    const keptBefore = await detail(kept.id);
    await api(owner, 'delete', `/groups/${group.id}`).expect(204);
    expect(
      await db.groupMembership.count({ where: { groupId: group.id } }),
    ).toBe(0);
    expect(
      await db.groupJoinRequest.count({ where: { groupId: group.id } }),
    ).toBe(0);
    expect(
      await db.groupNotification.count({ where: { groupId: group.id } }),
    ).toBe(0);
    expect(
      await db.groupCreateRequest.count({ where: { groupId: group.id } }),
    ).toBe(0);
    await api(member, 'get', `/groups/${group.id}`).expect(404);
    expect(await detail(kept.id)).toEqual(keptBefore);
    expect(
      await db.user.findMany({
        where: { id: { in: [owner.id, member.id] } },
        include: {
          currency: true,
          preference: true,
          sessions: true,
          curriculumAssignments: true,
          workoutRoutines: true,
        },
      }),
    ).toEqual(personal);
  });

  it('enforces capacity even for concurrent internal inserts and rejects membership moves', async () => {
    const group = await create(2);
    const results = await Promise.allSettled(
      [member, other].map((account) =>
        db.groupMembership.create({
          data: { groupId: group.id, userId: account.id },
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await db.groupMembership.count({ where: { groupId: group.id } }),
    ).toBe(2);
    await expect(
      db.group.update({ where: { id: group.id }, data: { maxMembers: 1 } }),
    ).rejects.toThrow();
    const another = await create(1);
    await expect(
      db.groupMembership.update({
        where: { groupId_userId: { groupId: group.id, userId: owner.id } },
        data: { groupId: another.id },
      }),
    ).rejects.toThrow();
  });

  it('keeps the group and remaining members when an ordinary member deletes their account', async () => {
    const group = await create();
    await join(group.id);
    await api(member, 'delete', '/users/me').send({ password }).expect(204);
    const view = await detail(group.id);
    expect(view.currentMembers).toBe(1);
    expect(view.members[0].userId).toBe(owner.id);
    expect(
      await db.groupJoinRequest.count({
        where: { groupId: group.id, userId: member.id },
      }),
    ).toBe(0);
    await api(member, 'get', `/groups/${group.id}`).expect(401);
  });

  it('calculates nonzero streaks from the same completed personal records, without assignment-date or page truncation', async () => {
    const group = await create();
    await join(group.id);
    const definition = await db.workoutCurriculum.create({
      data: { name: '[TEST ONLY] streak fixture' },
    });
    definitions.push(definition.id);
    const now = new Date();
    // Two completions on yesterday and one the day before: two streak days.
    const today = koreanDay(now);
    const midnight = new Date(`${today}T00:00:00+09:00`);
    for (const [index, offset] of [1, 1, 2, 4].entries()) {
      const completedAt = new Date(
        midnight.getTime() - offset * 86400000 + 3600000,
      );
      await db.userCurriculumAssignment.create({
        data: {
          userId: member.id,
          curriculumId: definition.id,
          requestKey: randomUUID(),
          assignmentDate: new Date(
            `2020-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
          ),
          assignedAt: new Date('2020-01-01T00:00:00Z'),
          algorithmVersion: 'test-only',
          inputSnapshot: {},
          status: 'completed',
          resultStatus: 'completed',
          completedAt,
          performedAt: completedAt,
        },
      });
    }
    const profile = await db.$transaction(async (tx) =>
      (await memberProfiles(tx, [member.id], now)).get(member.id),
    );
    expect(profile?.streak).toBe(2);
    const own = (
      await api(member, 'get', '/users/me/profile/activity').expect(200)
    ).body as { streak: number };
    const groupProfile = (
      await api(
        owner,
        'get',
        `/groups/${group.id}/members/${member.id}`,
      ).expect(200)
    ).body as { streak: number };
    expect(own.streak).toBe(2);
    expect(groupProfile.streak).toBe(own.streak);
  });

  it.each(['approve', 'reject', 'transfer'] as const)(
    'returns 404 rather than 500 when account deletion wins against %s',
    async (operation) => {
      const group = await create();
      const pending =
        operation === 'transfer' ? await join(group.id) : await apply(group.id);
      const locked = deferred<number>();
      const release = deferred<void>();
      const deletion = db.$transaction(
        async (tx) => {
          const [{ pid }] = await tx.$queryRaw<
            Array<{ pid: number }>
          >`SELECT pg_backend_pid() AS pid`;
          await tx.$queryRaw`SELECT id FROM ${db.table('users')} WHERE id = ${member.id}::uuid FOR UPDATE`;
          locked.resolve(pid);
          await release.promise;
          await tx.user.delete({ where: { id: member.id } });
        },
        { timeout: 10000 },
      );
      // Attach a rejection handler immediately so a test failure cannot leak work.
      const deletionResult = deletion.then(
        () => null,
        (error: unknown) => error,
      );
      let pendingResponse: Promise<request.Response> | undefined;
      try {
        const blocker = await locked.promise;
        pendingResponse = (
          operation === 'transfer'
            ? api(owner, 'post', `/groups/${group.id}/leadership`).send({
                userId: member.id,
              })
            : api(
                owner,
                'post',
                `/groups/${group.id}/join-requests/${pending.id}/${operation}`,
              )
        ).then((response) => response);
        // Observe an actual PostgreSQL lock wait instead of relying on timing.
        let blocked = false;
        for (let attempt = 0; attempt < 200; attempt++) {
          const [{ waiting }] = await db.$queryRaw<Array<{ waiting: boolean }>>`
            SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${blocker}::int = ANY(pg_blocking_pids(pid))) AS waiting
          `;
          if (waiting) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
        release.resolve();
        expect(await deletionResult).toBeNull();
        expect((await pendingResponse).status).toBe(404);
        const view = await detail(group.id);
        expect(view.members.map((row) => row.userId)).toEqual([owner.id]);
        expect(
          await db.groupJoinRequest.count({ where: { groupId: group.id } }),
        ).toBe(0);
        expect(
          await db.groupNotification.count({ where: { groupId: group.id } }),
        ).toBe(0);
      } finally {
        release.resolve();
        await deletionResult;
        await pendingResponse;
      }
    },
  );

  it('handles reciprocal applications by two group leaders without losing notifications', async () => {
    const first = await create();
    const second = await create(3, member);
    const firstCode = await groups.inviteCode(owner.id, first.id);
    const secondCode = await groups.inviteCode(member.id, second.id);
    const [a, b] = await Promise.all([
      groups.apply(owner.id, randomUUID(), secondCode.inviteCode),
      groups.apply(member.id, randomUUID(), firstCode.inviteCode),
    ]);
    expect(a.status).toBe('pending');
    expect(b.status).toBe('pending');
    expect(await notificationCount(a.id)).toBe(1);
    expect(await notificationCount(b.id)).toBe(1);
  });

  it('shares the personal activity profile calculation and bounds list pages', async () => {
    const group = await create();
    await join(group.id);
    const own = (
      await api(member, 'get', '/users/me/profile/activity').expect(200)
    ).body as Record<string, unknown>;
    const view = (
      await api(
        owner,
        'get',
        `/groups/${group.id}/members/${member.id}`,
      ).expect(200)
    ).body as Record<string, unknown>;
    expect(view).toMatchObject(own);
    await create();
    const first = (await api(owner, 'get', '/groups?limit=1').expect(200))
      .body as { items: GroupView[]; nextCursor: string };
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const next = (
      await api(
        owner,
        'get',
        `/groups?limit=1&cursor=${first.nextCursor}`,
      ).expect(200)
    ).body as { items: GroupView[] };
    expect(next.items).toHaveLength(1);
    expect(next.items[0].id).not.toBe(first.items[0].id);
  });
});
