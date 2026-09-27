/** Backend PR #9: trim and NFC-normalize before checking 2–20 supported characters. */
export const normalizeNickname = (value: string) =>
  value.trim().normalize("NFC");
const nicknamePattern = /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9_]{2,20}$/;
export function nicknameError(value: string): string | undefined {
  if (!nicknamePattern.test(normalizeNickname(value)))
    return "닉네임은 한글·영문·숫자·밑줄(_)로 2~20자 입력해 주세요.";
}
export function isStoredNickname(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value === normalizeNickname(value) &&
      nicknamePattern.test(value))
  );
}
export function parseNicknameProfile(value: unknown): {
  nickname: string | null;
} {
  if (
    typeof value !== "object" ||
    value === null ||
    !("nickname" in value) ||
    !isStoredNickname(value.nickname)
  )
    throw new Error("닉네임 응답을 확인하지 못했어요. 다시 불러와 주세요.");
  return { nickname: value.nickname };
}
