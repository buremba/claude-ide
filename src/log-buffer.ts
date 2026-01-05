/**
 * Circular buffer for storing log lines with fixed capacity
 */
export class LogBuffer {
  private buffer: string[] = [];
  private capacity: number;
  private writeIndex = 0;
  private size = 0;

  constructor(capacity = 1000) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  /**
   * Add a line to the buffer
   */
  push(line: string): void {
    this.buffer[this.writeIndex] = line;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  /**
   * Add multiple lines (e.g., from a chunk of output)
   */
  pushLines(text: string): void {
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.length > 0) {
        this.push(line);
      }
    }
  }

  /**
   * Get the last N lines from the buffer
   */
  tail(count?: number): string[] {
    const n = count ?? this.size;
    const actualCount = Math.min(n, this.size);
    const result: string[] = [];

    // Calculate start position
    let readIndex = this.size < this.capacity
      ? this.size - actualCount
      : (this.writeIndex - actualCount + this.capacity) % this.capacity;

    for (let i = 0; i < actualCount; i++) {
      result.push(this.buffer[readIndex]);
      readIndex = (readIndex + 1) % this.capacity;
    }

    return result;
  }

  /**
   * Get all lines as a single string
   */
  toString(count?: number): string {
    return this.tail(count).join("\n");
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.buffer = new Array(this.capacity);
    this.writeIndex = 0;
    this.size = 0;
  }

  /**
   * Get the current number of lines in the buffer
   */
  get length(): number {
    return this.size;
  }
}
