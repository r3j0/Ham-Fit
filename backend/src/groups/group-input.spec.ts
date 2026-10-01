import { describe, expect, it } from 'vitest';
import {
  createGroupSchema,
  joinGroupSchema,
  pageSchema,
  parseGroupInput,
  requestKey,
  updateGroupSchema,
} from './group-input.js';

describe('group input', () => {
  it('normalizes text and accepts creation and capacity updates up to five', () => {
    expect(
      parseGroupInput(createGroupSchema, {
        name: '  모임  ',
        description: '',
        maxMembers: 1,
      }),
    ).toEqual({ name: '모임', description: '', maxMembers: 1 });
    for (const body of [
      { name: '', description: '', maxMembers: 2 },
      { name: 'a', description: '', maxMembers: 0 },
      { name: 'a', description: '', maxMembers: 6 },
      { name: 'a', description: '', maxMembers: 2.5 },
      { name: 'a\nB', description: '', maxMembers: 2 },
      { name: 'a', description: '', maxMembers: 2, visibility: 'public' },
    ])
      expect(() => parseGroupInput(createGroupSchema, body)).toThrow();
    for (const body of [
      {},
      { maxMembers: 6 },
      { name: 'a'.repeat(51) },
      { description: 'x'.repeat(501) },
    ])
      expect(() => parseGroupInput(updateGroupSchema, body)).toThrow();
    expect(parseGroupInput(updateGroupSchema, { maxMembers: 4 })).toEqual({
      maxMembers: 4,
    });
  });
  it('validates opaque codes, request keys, and bounded pages without echoing codes', () => {
    expect(() => requestKey(undefined)).toThrow();
    expect(() =>
      parseGroupInput(joinGroupSchema, { inviteCode: 'secret' }),
    ).toThrow();
    expect(() => parseGroupInput(pageSchema, { limit: 51 })).toThrow();
    expect(() => parseGroupInput(pageSchema, { search: 'public' })).toThrow();
    expect(parseGroupInput(pageSchema, {})).toEqual({ limit: 20 });
  });
});
