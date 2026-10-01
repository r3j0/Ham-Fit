import { test, expect } from "@playwright/test";
import { installApi, testOutfit } from "./integration-fixtures";
import { installCommerce } from "./avatar-rewards-fixtures";

for (const width of [320, 600, 1280]) {
  test(`${width}px 상점 좌우 배치와 외곽선 없는 그룹 양식`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installCommerce(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/shop");
    const stage = page.getByRole("region", { name: "코디 미리보기" });
    const categories = page.getByRole("group", { name: "아이템 종류" });
    await expect(stage).toBeVisible();
    const left = (await stage.boundingBox())!,
      right = (await categories.boundingBox())!;
    if (width >= 960) {
      expect(right.x).toBeGreaterThanOrEqual(left.x + left.width);
      expect(right.y).toBeCloseTo(left.y, 0);
    } else expect(right.y).toBeGreaterThanOrEqual(left.y + left.height);
    await page.screenshot({
      path: info.outputPath(`shop-${width}.png`),
      fullPage: true,
    });
    await page.route("**/api/v1/groups**", (route) =>
      route.fulfill({ json: { items: [], nextCursor: null } }),
    );
    await page.goto("/groups");
    const forms = page.locator("section").filter({
      has: page.getByRole("heading", {
        name: /그룹 만들기|초대 코드로 가입 신청/,
      }),
    });
    await expect(forms).toHaveCount(2);
    const boxes = await forms.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          x: rect.x,
          right: rect.right,
          y: rect.y,
          border: getComputedStyle(node).borderWidth,
          parentBorder: getComputedStyle(node.parentElement!).borderWidth,
        };
      }),
    );
    expect(boxes[1].x).toBeGreaterThan(boxes[0].right);
    expect(boxes[0].y).toBeCloseTo(boxes[1].y, 0);
    for (const box of boxes) {
      expect(box.border).toBe("0px");
      expect(box.parentBorder).toBe("0px");
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`groups-${width}.png`),
      fullPage: true,
    });
  });
}

test("로그인 햄스터는 확대된 크기로 방문마다 무작위 색상·자세를 사용한다", async ({
  page,
}, info) => {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 401, json: { message: "Anonymous" } }),
  );
  // Control random draws to verify re-entry, without a probabilistic assertion.
  await page.addInitScript(() => {
    const original = crypto.getRandomValues.bind(crypto);
    // A development Strict Mode remount belongs to the same page visit.
    const visit = Number(sessionStorage.getItem("test-mascot-visit") || "0");
    sessionStorage.setItem("test-mascot-visit", String(visit + 1));
    crypto.getRandomValues = ((values: Uint32Array) => {
      if (values instanceof Uint32Array && values.length === 1) {
        for (let i = 0; i < values.length; i++)
          values[i] = visit % 2 ? 0xffffffff : 0;
        return values;
      }
      return original(values);
    }) as typeof crypto.getRandomValues;
  });
  await page.goto("/login");
  const group = page.getByRole("group", { name: "함께 운동하는 햄스터" });
  const mascots = group.locator(":scope > span");
  await expect(mascots).toHaveCount(4);
  await expect(group.locator('[data-variant="cream"]')).toHaveCount(2);
  await expect(group.locator('[data-variant="gray"]')).toHaveCount(2);
  const before = await mascots.evaluateAll((nodes) =>
    nodes.map((n) => [
      n.getAttribute("data-pose"),
      n.getAttribute("data-variant"),
    ]),
  );
  for (const width of [320, 600, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await group.boundingBox();
    for (const node of await mascots.all()) {
      await expect(node).toHaveAttribute("data-wear", "none");
      const box = (await node.boundingBox())!;
      expect(box.width / bounds!.width).toBeCloseTo(0.6076 / 1.1519, 3);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    await page.screenshot({
      path: info.outputPath(`login-${width}.png`),
      fullPage: true,
    });
  }
  await page.reload();
  await expect(mascots.nth(1)).toHaveAttribute("data-variant", "cream");
  expect(
    await mascots.evaluateAll((nodes) =>
      nodes.map((n) => [
        n.getAttribute("data-pose"),
        n.getAttribute("data-variant"),
      ]),
    ),
  ).not.toEqual(before);
});

test("가입의 선택 효과는 빅토리이며 저장 코디는 기본 자세를 유지한다", async ({
  page,
}) => {
  const server = await installApi(page);
  await page.goto("/welcome");
  await expect(page.locator("header.page-header")).toHaveCount(0);
  await expect(page.getByText("처음 만나 반가워요")).toHaveCount(0);
  const cream = page.getByRole("button", { name: "햄돌이", exact: true });
  const gray = page.getByRole("button", { name: "햄콩이", exact: true });
  await expect(cream.locator("[data-pose]")).toHaveAttribute(
    "data-pose",
    "victory",
  );
  await expect(gray.locator("[data-pose]")).toHaveAttribute(
    "data-pose",
    "basic",
  );
  await gray.click();
  await expect(gray.locator("[data-pose]")).toHaveAttribute(
    "data-pose",
    "victory",
  );
  await expect(cream.locator("[data-pose]")).toHaveAttribute(
    "data-pose",
    "basic",
  );
  await page.getByLabel("닉네임", { exact: true }).fill("검증햄스터");
  await page.getByRole("button", { name: "저장하고 다음으로" }).click();
  await expect(page).toHaveURL("/onboarding");
  expect(
    server.mutations.find((m) => m.path.endsWith("/avatar/outfit"))?.body,
  ).toMatchObject({
    characterId: "character.gray",
    poseId: "pose.basic",
    clothingIds: [],
  });
});

test("간이측정은 회원 햄스터·나이를 사용하고 성별·허리 도움말·실제 영상 프레임을 배치한다", async ({
  page,
}, info) => {
  await installApi(page);
  await page.route("**/avatar/outfit", (route) =>
    route.fulfill({
      json: {
        ...testOutfit,
        characterId: "character.gray",
        rendering: { variant: "gray", pose: "basic", clothing: [] },
      },
    }),
  );
  await page.route("https://www.youtube-nocookie.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><body>YouTube frame contract</body></html>",
    }),
  );
  await page.goto("/workout?mode=assessment");
  await expect(page.getByLabel("측정 당시 나이")).toContainText("만 25세");
  await expect(
    page.locator(".assessment-hero [data-pose='situp']"),
  ).toHaveAttribute("data-variant", "gray");
  await expect(page.getByLabel("만 나이", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText(
      /측정 전 확인|KNOW YOUR BODY|만 19~64세 성인 간이측정|스텝검사는 측정 당시|스텝검사 평가에 필요한 정보|매트, 30cm/,
    ),
  ).toHaveCount(0);
  const body = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "신체정보 (선택)" }) });
  await expect(body.getByLabel("성별 (선택)")).toBeVisible();
  await expect(page.locator("#assessment-waist-hint")).toBeVisible();
  expect(
    await page
      .locator("#assessment-waist")
      .evaluate(
        (node) =>
          node.parentElement!.querySelector("#assessment-waist-hint") !== null,
      ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("assessment-setup.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "측정 준비 완료" }).click();
  for (const id of ["j5sktGOVq1c", "xFtWEPFp5wM", "ydKH9ybDUZ4"]) {
    await expect(page.locator("iframe")).toHaveAttribute(
      "src",
      `https://www.youtube-nocookie.com/embed/${id}`,
    );
    await page.getByRole("button", { name: "이 항목 건너뛰기" }).click();
  }
});

for (const mode of ["manual", "photo"])
  test(`${mode} 입력의 나이는 측정일·생년월일로 계산하며 실제 저장 요청에 반영한다`, async ({
    page,
  }, info) => {
    const server = await installApi(page);
    await page.route("**/users/me/profile", (route) =>
      route.fulfill({ json: { dateOfBirth: "2001-09-15", currentAge: 25 } }),
    );
    await page.goto(`/onboarding/${mode}`);
    if (mode === "photo") {
      await page.getByLabel("결과표 파일 선택").setInputFiles({
        name: "report.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          "base64",
        ),
      });
      await page
        .getByRole("button", { name: "이 사진을 보며 직접 입력" })
        .click();
    }
    await expect(
      page.getByLabel("측정 당시 만 나이", { exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("측정일", { exact: true }).fill("2026-09-14");
    await expect(page.getByLabel("측정 당시 나이")).toContainText("만 24세");
    await page.getByLabel("측정일", { exact: true }).fill("2026-09-15");
    await expect(page.getByLabel("측정 당시 나이")).toContainText("만 25세");
    await page.getByLabel("성별", { exact: true }).selectOption("female");
    await page.screenshot({
      path: info.outputPath(`${mode}-profile-age.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "측정값 입력하기" }).click();
    await page
      .getByRole("button", { name: "측정 항목 추가", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button")
      .filter({ hasText: "교차 윗몸일으키기" })
      .click();
    await page.locator("#value-cross_sit_up").fill("30");
    await page
      .getByRole("button", { name: "1개 항목 저장하기", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "나의 체력을 기록했어요" }),
    ).toBeVisible();
    expect(
      server.mutations.find((m) => m.path === "/measurements")?.body,
    ).toMatchObject({ measuredOn: "2026-09-15", ageAtMeasurement: 25 });
    await expect(
      page.locator(".assessment-complete [data-pose='victory']"),
    ).toHaveAttribute("data-variant", "cream");
  });

test("생년월일 누락·조회 실패·성인 범위 밖은 잘못된 나이로 진행하지 않는다", async ({
  page,
}) => {
  await installApi(page);
  let birth: string | null = null,
    fail = false;
  await page.route("**/users/me/profile", (route) =>
    route.fulfill(
      fail
        ? { status: 503, json: { message: "Unavailable" } }
        : { json: { dateOfBirth: birth, currentAge: null } },
    ),
  );
  await page.goto("/workout?mode=assessment");
  await expect(page.getByRole("link", { name: "생년월일 등록" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "측정 준비 완료" }),
  ).toBeDisabled();
  fail = true;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "다시 불러오기", exact: true }),
  ).toBeVisible();
  fail = false;
  birth = "2010-01-01";
  await page
    .getByRole("button", { name: "다시 불러오기", exact: true })
    .click();
  await expect(
    page.getByText("성인 간이측정은 만 19~64세를 지원해요."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "측정 준비 완료" }),
  ).toBeDisabled();
  birth = null;
  await page.goto("/onboarding/manual");
  await page.getByLabel("측정일", { exact: true }).fill("2026-09-15");
  await expect(page.getByRole("link", { name: "생년월일 등록" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "측정값 입력하기" }),
  ).toBeDisabled();
});

for (const width of [600, 1280]) {
  test(`${width}px 상점 초기화는 미리보기 안에 있고 구매 버튼은 바로 아래에 있다`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await installCommerce(page);
    await page.goto("/shop");
    const stage = page.getByRole("region", { name: "코디 미리보기" });
    await expect(stage.getByRole("button", { name: "초기화" })).toHaveCount(0);
    await page.getByRole("button", { name: "상의", exact: true }).click();
    await page.getByRole("button", { name: /민트 티셔츠.*25개/ }).click();
    const reset = stage.getByRole("button", { name: "초기화" });
    const purchase = page.getByRole("button", { name: /민트 티셔츠 구매하기/ });
    await expect(reset).toBeVisible();
    await expect(purchase).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "의상 없이 미리 보기" }),
    ).toHaveCount(0);
    const box = (await stage.boundingBox())!,
      r = (await reset.boundingBox())!,
      p = (await purchase.boundingBox())!;
    expect(r.x).toBeGreaterThan(box.x + box.width / 2);
    expect(r.y).toBeGreaterThan(box.y + box.height / 2);
    expect(r.x + r.width).toBeLessThanOrEqual(box.x + box.width);
    expect(r.y + r.height).toBeLessThanOrEqual(box.y + box.height);
    expect(p.y).toBeGreaterThanOrEqual(box.y + box.height);
    if (width < 960) {
      const categories = (await page
        .getByRole("group", { name: "아이템 종류" })
        .boundingBox())!;
      expect(categories.y).toBeGreaterThanOrEqual(p.y + p.height);
    } else expect(p.x).toBeCloseTo(box.x, 0);
    await page.screenshot({
      path: info.outputPath(`shop-actions-${width}.png`),
      fullPage: true,
    });
    await reset.click();
    await expect(reset).toHaveCount(0);
    await expect(stage.locator('[data-layer="clothing"]')).toHaveCount(0);
    expect(state.puts).toBe(0);
    await purchase.click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
}

test("그룹의 안내 햄스터는 회원의 색상을 사용하며 핸드폰 자세를 유지한다", async ({
  page,
}) => {
  const state = await installCommerce(page);
  state.outfit.characterId = "character.gray";
  state.outfit.rendering.variant = "gray";
  await page.goto("/groups");
  const mascot = page.locator('[data-pose="phone"][data-wear="none"]');
  await expect(mascot).toHaveAttribute("data-variant", "gray");
  await expect(mascot).toHaveAccessibleName(/햄콩이/);
});
