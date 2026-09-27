import { BadRequestException } from '@nestjs/common';

export function parseNickname(value: unknown): string {
  const nickname =
    typeof value === 'string' ? value.trim().normalize('NFC') : '';
  if (!/^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9_]{2,20}$/.test(nickname))
    throw new BadRequestException({
      statusCode: 400,
      code: 'INVALID_NICKNAME',
      message: '닉네임은 한글·영문·숫자·밑줄(_)로 2~20자 입력해 주세요.',
      errors: [{ field: 'nickname', message: '닉네임 형식을 확인해 주세요.' }],
    });
  return nickname;
}
