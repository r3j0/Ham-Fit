import type { Page } from "@playwright/test";
import type { GroupDetail } from "../../lib/groups";
import { testUser } from "./integration-fixtures";

export function homeGroup(index = 1, count = 4): GroupDetail {
  const createdAt = "2026-09-29T00:00:00Z";
  return {
    id: `77777777-1111-4111-8111-${String(index).padStart(12, "0")}`,
    name: index === 1 ? "매일 함께 운동" : `건강한 그룹 ${index}`,
    description: "그룹 API 계약 검사 전용 데이터",
    maxMembers: 100,
    currentMembers: count,
    createdAt,
    members: Array.from({ length: count }, (_, i) => ({
      userId:
        i === 0
          ? testUser.id
          : `88888888-1111-4111-8111-${String(index * 100 + i).padStart(12, "0")}`,
      nickname: `운동친구_${index}_${i + 1}`,
      profileCharacter: null,
      role: i === 0 ? "leader" : "member",
      streak: i,
      joinedAt: createdAt,
    })),
  };
}

export async function installHomeGroups(page: Page, rows = [homeGroup()]) {
  await page.route("**/api/v1/groups?*", (route) =>
    route.fulfill({
      json: {
        items: rows.map((group) => ({
          id: group.id,
          name: group.name,
          description: group.description,
          maxMembers: group.maxMembers,
          currentMembers: group.currentMembers,
          createdAt: group.createdAt,
          role: "leader",
        })),
        nextCursor: null,
      },
    }),
  );
  for (const row of rows)
    await page.route(`**/api/v1/groups/${row.id}`, (route) =>
      route.fulfill({ json: row }),
    );
}
