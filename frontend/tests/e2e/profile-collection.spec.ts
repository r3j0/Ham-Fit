import { expect, test } from "@playwright/test";
import { installCommerce, rewardDate } from "./avatar-rewards-fixtures";
import { installApi, testRecord, testUser } from "./integration-fixtures";

const inventory = (ids: string[]) => ({
  currency: { balance: 0 },
  inventory: ids.map((productId) => ({
    productId,
    source: "default",
    acquiredAt: rewardDate,
  })),
});

test("컬렉션은 기본 지급과 구매한 상품을 세며 구매 후 이동·새로고침에 갱신된다", async ({
  page,
}) => {
  await installCommerce(page);
  const collection = page
    .locator(".profile-report-metric")
    .filter({ hasText: "캐릭터 보유 컬렉션" });
  await page.goto("/account");
  await expect(collection.locator("dd")).toHaveText("3개");
  await page.goto("/shop");
  await page.getByRole("button", { name: "자세", exact: true }).click();
  await page.getByRole("button", { name: /궁금.*50개/ }).click();
  await page.getByRole("button", { name: /궁금 구매하기/ }).click();
  await page.getByRole("button", { name: "구매 확정", exact: true }).click();
  await expect(
    page.getByText("구매했어요. 내 옷장에서 착용하고 저장할 수 있어요."),
  ).toBeVisible();
  await page.goto("/account");
  await expect(collection.locator("dd")).toHaveText("4개");
  await page.reload();
  await expect(collection.locator("dd")).toHaveText("4개");
});

test("컬렉션 조회 실패·잘못된 중복 응답은 0이나 이전 수치로 표시하지 않고 재시도한다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  let mode = "success";
  await page.route("**/users/me/avatar/inventory", (route) =>
    mode === "failure"
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({
          json: inventory(
            mode === "empty"
              ? []
              : mode === "duplicate"
                ? ["pose.basic", "pose.basic"]
                : ["character.cream", "character.gray", "pose.basic"],
          ),
        }),
  );
  const collection = page
    .locator(".profile-report-metric")
    .filter({ hasText: "캐릭터 보유 컬렉션" });
  await page.goto("/account");
  await expect(collection.locator("dd")).toHaveText("3개");
  for (const failure of ["failure", "duplicate"]) {
    mode = failure;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(collection.locator("dd")).toHaveText("—확인 필요");
    await expect(
      page.getByText("보유 컬렉션을 확인하지 못했어요."),
    ).toBeVisible();
  }
  mode = "empty";
  await page.getByRole("button", { name: "컬렉션 다시 불러오기" }).click();
  await expect(collection.locator("dd")).toHaveText("0개");
  await expect(page.getByText("보유 컬렉션을 확인하지 못했어요.")).toHaveCount(
    0,
  );
});

test("계정 전환 뒤 늦게 도착한 이전 컬렉션은 새 사용자에게 표시하지 않는다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  let owner = testUser;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  let previousRequestsSettled = 0;
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      json: {
        ...owner,
        nickname: null,
        isOnboarded: false,
        currency: { balance: 0 },
        currentCurriculum: null,
      },
    }),
  );
  await page.route("**/users/me/avatar/inventory", async (route) => {
    requests++;
    const first = owner.id === testUser.id;
    if (first) await pending;
    await route
      .fulfill({
        json: inventory(first ? ["pose.old", "pose.other"] : ["pose.new"]),
      })
      .catch(() => {});
    if (first) previousRequestsSettled++;
  });
  await page.goto("/account");
  await expect.poll(() => requests).toBeGreaterThan(0);
  const previousRequests = requests;
  owner = { ...testUser, id: "99999999-1111-4111-8111-111111111111" };
  await page.evaluate((user) => {
    const channel = new BroadcastChannel("modu-auth-session");
    channel.postMessage({
      type: "authenticated",
      newLogin: true,
      auth: { user, access_token: "new-account-token" },
    });
    channel.close();
  }, owner);
  const collection = page
    .locator(".profile-report-metric")
    .filter({ hasText: "캐릭터 보유 컬렉션" });
  await expect(collection.locator("dd")).toHaveText("1개");
  release();
  await expect.poll(() => previousRequestsSettled).toBe(previousRequests);
  await expect(collection.locator("dd")).toHaveText("1개");
});
