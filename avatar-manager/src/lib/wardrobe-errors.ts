export class WardrobeStoreError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
