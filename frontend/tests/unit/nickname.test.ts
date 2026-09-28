import test from "node:test";
import assert from "node:assert/strict";
import {
  nicknameError,
  normalizeNickname,
  isStoredNickname,
  parseNicknameProfile,
} from "../../lib/nickname.ts";

test("nicknames use the backend's trim, NFC, character set, and length boundaries", () => {
  for (const value of [
    "건강",
    "Ab_12",
    "ㄱㅏ",
    "가".repeat(20),
    "  건강친구  ",
    "건강",
  ])
    assert.equal(nicknameError(value), undefined, value);
  assert.equal(normalizeNickname("  건강  "), "건강");
  for (const value of [
    "",
    " ",
    "가",
    "가".repeat(21),
    "건강 친구",
    "친구🙂",
    "a-b",
    "a.b",
    "a\nb",
    "a\u0000b",
    "ａｂ",
  ])
    assert.equal(typeof nicknameError(value), "string", value);
});
test("nickname responses require an explicit null or valid canonical nickname", () => {
  assert.deepEqual(parseNicknameProfile({ nickname: null }), {
    nickname: null,
  });
  assert.deepEqual(
    parseNicknameProfile({ nickname: "건강친구", dateOfBirth: "2000-02-29" }),
    { nickname: "건강친구" },
  );
  for (const value of [
    undefined,
    123,
    "",
    "건강 친구",
    " 친구 ",
    "건강",
    "a".repeat(21),
  ]) {
    assert.equal(isStoredNickname(value), false);
    assert.throws(() => parseNicknameProfile({ nickname: value }));
  }
  for (const value of [null, {}, [], "건강친구"])
    assert.throws(() => parseNicknameProfile(value));
});
