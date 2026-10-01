import test from "node:test";
import assert from "node:assert/strict";
import { authDestination } from "../../lib/auth-destination.ts";
test("인증 후 간이측정 모드와 기존 입력 경로를 복원한다", () => {
  assert.equal(
    authDestination("/workout?mode=assessment"),
    "/workout?mode=assessment",
  );
  assert.equal(
    authDestination("/workout?curriculum=adult-self-assessment-v1"),
    "/workout?mode=assessment",
  );
  for (const path of [
    "/onboarding/photo",
    "/onboarding/manual",
    "/workout",
    "/workouts/history/2026-09-27",
    "/workouts/00000000-0000-4000-8000-000000000002/replay",
    "/account/preferences",
    "/account/workouts/history/2026-09-27",
    "/account/workouts/00000000-0000-4000-8000-000000000002/replay",
    "/workouts/00000000-0000-4000-8000-000000000002",
    "/measurements/1234-abcd/edit",
  ])
    assert.equal(authDestination(path), path);
});
test("외부 주소·중복 모드·임의 커리큘럼은 인증 후 실행하지 않는다", () => {
  for (const path of [
    "/workouts",
    "/account/workouts",
    "https://example.com",
    "//example.com",
    "/\\example.com",
    "/account/workouts/../../login",
    "/account/workouts?next=//example.com",
    "/account/workouts/history/2026-09-27#redirect",
    "/account/workouts//example.com/replay",
    "/workout?mode=assessment&mode=other",
    "/workout?curriculum=assigned-curriculum",
    "/workout?mode=assessment&redirect=//example.com",
    "/workout?mode=assessment#other",
  ])
    assert.equal(authDestination(path), "/");
});

test("저장 완료 화면은 하나의 내부 기록 ID만 재인증 후 복원한다", () => {
  const id = "00000000-0000-4000-8000-000000000004";
  assert.equal(
    authDestination(`/onboarding/complete?record=${id}`),
    `/onboarding/complete?record=${id}`,
  );
  for (const suffix of [
    "",
    "record=https://example.test",
    `record=${id}&record=${id}`,
    `record=${id}&next=/account`,
    `record=${id}#fragment`,
  ])
    assert.equal(authDestination(`/onboarding/complete?${suffix}`), "/");
});
