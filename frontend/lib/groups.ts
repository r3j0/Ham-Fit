import { api } from "./session";
import { ApiError, errorMessage } from "./http";
import { parseAvatarOutfit, type AvatarOutfit } from "./avatar-outfit";
import {
  object,
  invalid,
  uuid,
  timestamp,
  integer,
  text,
  pageOf,
} from "./api-contract";
export type Role = "leader" | "member";
export type RequestStatus = "pending" | "approved" | "rejected";
export interface ActivityProfile {
  userId: string;
  nickname: string | null;
  profileCharacter: AvatarOutfit | null;
  streak: number;
  longestStreak?: number;
  totalWorkoutDays?: number;
}
export interface Member extends ActivityProfile {
  role: Role;
  joinedAt: string;
  todayWorkoutCompleted?: boolean;
  missionContribution?: { roundId: string; waterCount: number } | null;
}
export interface Group {
  id: string;
  name: string;
  description: string;
  maxMembers: number;
  currentMembers: number;
  createdAt: string;
}
export interface MyGroup extends Group {
  role: Role;
}
export interface GroupDetail extends Group {
  members: Member[];
}
export interface GroupOverview extends GroupDetail {
  role: Role;
}
export interface JoinRequest {
  id: string;
  groupId: string;
  userId: string;
  status: RequestStatus;
  createdAt: string;
  processedAt: string | null;
  nickname?: string | null;
}
const role = (value: unknown) => value === "leader" || value === "member";
export function parseActivity(value: unknown): ActivityProfile {
  const row = object(value);
  if (
    !uuid(row.userId) ||
    !(row.nickname === null || text(row.nickname)) ||
    !integer(row.streak) ||
    (row.longestStreak !== undefined && !integer(row.longestStreak)) ||
    (row.totalWorkoutDays !== undefined && !integer(row.totalWorkoutDays))
  )
    invalid();
  if (row.profileCharacter !== null) parseAvatarOutfit(row.profileCharacter);
  return row as unknown as ActivityProfile;
}
export function parseMember(value: unknown): Member {
  const row = object(value);
  parseActivity(row);
  if (
    !role(row.role) ||
    !timestamp(row.joinedAt) ||
    (row.todayWorkoutCompleted !== undefined &&
      typeof row.todayWorkoutCompleted !== "boolean")
  )
    invalid();
  if (
    row.missionContribution !== undefined &&
    row.missionContribution !== null
  ) {
    const contribution = object(row.missionContribution);
    if (!uuid(contribution.roundId) || !integer(contribution.waterCount))
      invalid();
  }
  return row as unknown as Member;
}
export function parseGroup(value: unknown): Group {
  const row = object(value);
  if (
    !uuid(row.id) ||
    !text(row.name) ||
    typeof row.description !== "string" ||
    !integer(row.maxMembers, 1) ||
    row.maxMembers > 5 ||
    !integer(row.currentMembers, 1) ||
    !timestamp(row.createdAt)
  )
    invalid();
  return row as unknown as Group;
}
export function parseMyGroup(value: unknown): MyGroup {
  const row = object(value);
  parseGroup(row);
  if (!role(row.role)) invalid();
  return row as unknown as MyGroup;
}
export function parseGroupDetail(value: unknown): GroupDetail {
  const row = object(value);
  parseGroup(row);
  if (!Array.isArray(row.members)) invalid();
  const members = row.members.map(parseMember);
  if (
    members.length !== row.currentMembers ||
    new Set(members.map((m) => m.userId)).size !== members.length ||
    members.filter((m) => m.role === "leader").length !== 1
  )
    invalid();
  return { ...row, members } as unknown as GroupDetail;
}
export function parseJoinRequest(value: unknown): JoinRequest {
  const row = object(value);
  if (
    ![row.id, row.groupId, row.userId].every(uuid) ||
    !["pending", "approved", "rejected"].includes(String(row.status)) ||
    !timestamp(row.createdAt) ||
    !(row.processedAt === null || timestamp(row.processedAt)) ||
    (row.status === "pending") !== (row.processedAt === null) ||
    !(row.nickname === undefined || row.nickname === null || text(row.nickname))
  )
    invalid();
  return row as unknown as JoinRequest;
}
export async function readPages<T extends { id: string }>(
  path: string,
  parse: (value: unknown) => T,
  signal?: AbortSignal,
) {
  const rows = new Map<string, T>(),
    cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const { data }: { data: unknown } = await api<unknown>(
      `${path}${path.includes("?") ? "&" : "?"}limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      { signal },
    );
    const page: { items: T[]; nextCursor: string | null } = pageOf(data, parse);
    page.items.forEach((row) => rows.set(row.id, row));
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) invalid();
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return [...rows.values()];
}
export const getGroups = (signal?: AbortSignal) =>
  readPages("/groups", parseMyGroup, signal);
export function parseGroupOverview(value: unknown): GroupOverview[] {
  const row = object(value);
  if (!Array.isArray(row.items)) invalid();
  const items = row.items.map((value) => {
    const group = parseGroupDetail(value);
    parseMyGroup(value);
    // The new aggregate contract always supplies today's completion status.
    if (
      group.members.some(
        (member) => typeof member.todayWorkoutCompleted !== "boolean",
      )
    )
      invalid();
    return group as GroupOverview;
  });
  if (new Set(items.map((group) => group.id)).size !== items.length) invalid();
  return items;
}
export const getGroupOverview = (signal?: AbortSignal) =>
  api<unknown>("/groups/overview", { signal }).then(({ data }) =>
    parseGroupOverview(data),
  );
export const getGroup = (id: string, signal?: AbortSignal) =>
  api<unknown>(`/groups/${id}`, { signal }).then(({ data }) => {
    const row = parseGroupDetail(data);
    if (row.id !== id) invalid();
    return row;
  });
export const getMember = (id: string, userId: string, signal?: AbortSignal) =>
  api<unknown>(`/groups/${id}/members/${userId}`, { signal }).then(
    ({ data }) => {
      const row = parseMember(data);
      if (row.userId !== userId) invalid();
      return row;
    },
  );
export const getRequests = (
  id: string,
  status: RequestStatus,
  signal?: AbortSignal,
) =>
  readPages(
    `/groups/${id}/join-requests?status=${status}`,
    parseJoinRequest,
    signal,
  );
export async function groupMutation(
  path: string,
  method: string,
  body?: string,
  key?: string,
) {
  return (
    await api<unknown>(`/groups${path}`, {
      method,
      headers: {
        "X-CSRF-Protection": "1",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body === undefined ? {} : { body }),
    })
  ).data;
}
export function groupError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "GROUP_CAPACITY_BELOW_MEMBERS")
      return "현재 그룹원 수보다 정원을 줄일 수 없어요. 최신 인원을 확인해 주세요.";
    if (error.status === 403)
      return "그룹장만 처리할 수 있어요. 최신 권한을 다시 확인해 주세요.";
    if (error.status === 404)
      return "그룹이나 초대 코드를 찾을 수 없거나 접근 권한이 없어요.";
    if (error.status === 409)
      return "현재 그룹 상태와 맞지 않는 요청이에요. 정원, 가입 여부와 그룹장 권한을 확인해 주세요.";
    if (error.status === 410)
      return "이 요청의 그룹은 삭제되었어요. 새 요청으로 진행해 주세요.";
    if (error.status === 400)
      return (
        Object.values(error.fields).join(" ") || "입력한 내용을 확인해 주세요."
      );
  }
  return errorMessage(error);
}
export function groupInput(
  name: string,
  description: string,
  maxMembers?: number,
) {
  const result = {
    name: name.normalize("NFC").trim(),
    description: description.normalize("NFC").trim(),
    ...(maxMembers === undefined ? {} : { maxMembers }),
  };
  if (
    !result.name ||
    result.name.length > 50 ||
    result.description.length > 500 ||
    /[\p{Cc}\p{Cf}]/u.test(result.name + result.description) ||
    (maxMembers !== undefined &&
      (!Number.isInteger(maxMembers) || maxMembers < 1 || maxMembers > 5))
  )
    throw new Error(
      "이름은 1~50자, 소개는 500자 이내로 줄바꿈 없이 입력해 주세요. 정원은 1~5명이에요.",
    );
  return result;
}
