export class RingBuffer<T> {
  private readonly values: T[];
  private readonly capacity: number;
  private cursor = 0;
  private size = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("capacity must be a positive integer");
    }
    this.capacity = capacity;
    this.values = new Array<T>(capacity);
  }

  push(value: T): void {
    this.values[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
  }

  pushMany(items: readonly T[]): void {
    for (const item of items) this.push(item);
  }

  toArray(limit = this.size): T[] {
    const count = Math.max(0, Math.min(this.size, Math.floor(limit)));
    if (count === 0) return [];

    const result = new Array<T>(count);
    const start = (this.cursor - count + this.capacity) % this.capacity;

    for (let index = 0; index < count; index++) {
      result[index] = this.values[(start + index) % this.capacity];
    }

    return result;
  }

  clear(): void {
    this.cursor = 0;
    this.size = 0;
  }
}
