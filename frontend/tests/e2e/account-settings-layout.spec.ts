import { test, expect } from "@playwright/test";
import { installApi, testOutfit } from "./integration-fixtures";
for (const variant of ["cream", "gray"] as const) {
  test(`탈퇴 확인은 현재 ${variant} 햄스터의 안 들려 자세를 사용하고 취소는 요청하지 않는다`, async ({
    page,
  }) => {
    const server = await installApi(page);
    await page.route("**/users/me/avatar/outfit", (route) =>
      route.fulfill({
        json: {
          ...testOutfit,
          characterId: `character.${variant}`,
          rendering: { ...testOutfit.rendering, variant },
        },
      }),
    );
    await page.goto("/account/settings?tab=delete");
    const form = page.getByRole("form", { name: "회원 탈퇴", exact: true });
    await form.getByLabel("현재 비밀번호").fill("not-submitted-password");
    await form.getByRole("button", { name: "회원 탈퇴", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "정말 탈퇴할까요?" });
    await expect(
      dialog.locator(`[data-variant="${variant}"][data-pose="cant-hear"]`),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(server.mutations).toEqual([]);
  });
}
test("계정 작업은 비밀번호를 공유하지 않고 요청 중 다른 변경을 잠그며 결과 불명확 시 재로그인을 제공한다", async ({
  page,
}) => {
  await installApi(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes: unknown[] = [];
  await page.route("**/api/v1/users/me", async (route) => {
    expect(route.request().method()).toBe("PATCH");
    expect(route.request().headers()["x-csrf-protection"]).toBe("1");
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    writes.push(route.request().postDataJSON());
    await gate;
    await route.abort("connectionreset");
  });
  await page.goto("/account/settings");
  const email = page.getByRole("form", { name: "이메일 변경", exact: true });
  const password = page.getByRole("form", {
    name: "비밀번호 변경",
    exact: true,
  });
  const deletion = page.getByRole("form", { name: "회원 탈퇴", exact: true });
  await expect(page.getByLabel("닉네임", { exact: true })).toBeEnabled();
  await email.getByLabel("현재 비밀번호").fill("email-password");
  await password.getByLabel("현재 비밀번호").fill("password-password");
  await deletion.getByLabel("현재 비밀번호").fill("delete-password");
  await email.getByLabel("현재 비밀번호").fill("email-password-edited");
  await expect(password.getByLabel("현재 비밀번호")).toHaveValue(
    "password-password",
  );
  await expect(deletion.getByLabel("현재 비밀번호")).toHaveValue(
    "delete-password",
  );
  await password
    .getByLabel("새 비밀번호", { exact: true })
    .fill("long-new-password!");
  await password.getByLabel("새 비밀번호 확인").fill("different-password!");
  await password
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .click();
  await expect(
    password.getByText("새 비밀번호가 일치하지 않아요."),
  ).toBeVisible();
  expect(writes).toHaveLength(0);
  await email.getByLabel("새 이메일").fill("edited@example.test");
  await email.getByRole("button", { name: "이메일 변경", exact: true }).click();
  await expect(page.getByLabel("닉네임", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("생년월일 입력")).toBeDisabled();
  await expect(password.getByLabel("현재 비밀번호")).toBeDisabled();
  await expect(
    deletion.getByRole("button", { name: "회원 탈퇴", exact: true }),
  ).toBeDisabled();
  await expect
    .poll(() => writes)
    .toEqual([
      {
        currentPassword: "email-password-edited",
        email: "edited@example.test",
      },
    ]);
  release();
  await expect(email.getByRole("alert")).toContainText(
    "처리 결과를 확인하지 못했어요",
  );
  await expect(
    email.getByRole("button", { name: "다시 로그인하기" }),
  ).toBeEnabled();
  for (const form of [email, password, deletion]) {
    await expect(form.getByLabel("현재 비밀번호")).toHaveValue("");
    await expect(form.getByLabel("현재 비밀번호")).toBeDisabled();
  }
  await email.getByRole("button", { name: "다시 로그인하기" }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(writes).toHaveLength(1);
});

for (const action of ["password", "delete"] as const) {
  test(`${action} 변경은 해당 폼의 비밀번호만 전송하고 성공 후 로그아웃한다`, async ({
    page,
  }) => {
    await installApi(page);
    const writes: { method: string; body: unknown }[] = [];
    await page.route("**/api/v1/users/me", (route) => {
      writes.push({
        method: route.request().method(),
        body: route.request().postDataJSON(),
      });
      expect(route.request().headers()["x-csrf-protection"]).toBe("1");
      return route.fulfill({ status: 204 });
    });
    await page.goto("/account/settings");
    const title = action === "delete" ? "회원 탈퇴" : "비밀번호 변경";
    const form = page.getByRole("form", { name: title, exact: true });
    await page
      .getByRole("form", { name: "이메일 변경", exact: true })
      .getByLabel("현재 비밀번호")
      .fill("unrelated-draft");
    await form.getByLabel("현재 비밀번호").fill("correct-current-password");
    if (action === "password") {
      await form
        .getByLabel("새 비밀번호", { exact: true })
        .fill("confirmed-new-password!");
      await form.getByLabel("새 비밀번호 확인").fill("confirmed-new-password!");
    }
    await form.getByRole("button", { name: title, exact: true }).click();
    if (action === "delete")
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "영구 탈퇴하기" })
        .click();
    await expect(page).toHaveURL(/\/login/);
    expect(writes).toEqual([
      {
        method: action === "delete" ? "DELETE" : "PATCH",
        body:
          action === "delete"
            ? { password: "correct-current-password" }
            : {
                currentPassword: "correct-current-password",
                newPassword: "confirmed-new-password!",
              },
      },
    ]);
  });
}

test("그룹장은 탈퇴 거절 시 계정과 입력을 유지하고 그룹 관리로 이동할 수 있다", async ({
  page,
}) => {
  await installApi(page);
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({ status: 409, json: { message: "Leader" } }),
  );
  await page.goto("/account/settings?tab=delete");
  const form = page.getByRole("form", { name: "회원 탈퇴", exact: true });
  await form.getByLabel("현재 비밀번호").fill("current-password");
  await form.getByRole("button", { name: "회원 탈퇴", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "영구 탈퇴하기" })
    .click();
  await expect(form.getByRole("alert")).toContainText("그룹장은 탈퇴 전에");
  await expect(
    form.getByRole("link", { name: "내 그룹 관리하기" }),
  ).toHaveAttribute("href", "/groups");
  await expect(form.getByLabel("현재 비밀번호")).toHaveValue(
    "current-password",
  );
  await expect(
    form.getByRole("button", { name: "회원 탈퇴", exact: true }),
  ).toBeEnabled();
});
