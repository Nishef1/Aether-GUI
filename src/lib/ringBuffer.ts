export class RingBuffer<T> {
  private readonly values: T[];
  private cursor = 0;
  private size = 0;

  constructor(private readonly capacity: number) {
    if (capacity <= 0) throw new Error("capacity must be positive");
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

  toArray(): T[] {
    const result = new Array<T>(this.size);
    const start = (this.cursor - this.size + this.capacity) % this.capacity;

    for (let index = 0; index < this.size; index++) {
      result[index] = this.values[(start + index) % this.capacity];
    }

    return result;
  }

  clear(): void {
    this.cursor = 0;
    this.size = 0;
  }
}
