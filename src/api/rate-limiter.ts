const RATE_LIMIT = 3; // requests per second
const RATE_WINDOW = 1000; // 1 second in ms

export class RateLimiter {
  private timestamps: number[] = [];

  async waitForSlot(): Promise<void> {
    const now = Date.now();

    // Remove timestamps older than the rate window
    this.timestamps = this.timestamps.filter(t => now - t < RATE_WINDOW);

    if (this.timestamps.length >= RATE_LIMIT) {
      // Calculate wait time until oldest timestamp expires
      const oldestTimestamp = this.timestamps[0];
      const waitTime = RATE_WINDOW - (now - oldestTimestamp) + 10; // +10ms buffer

      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
        // Recursively check again after waiting
        return this.waitForSlot();
      }
    }

    this.timestamps.push(Date.now());
  }
}

// Shared rate limiter instance (all services share the same rate limit)
export const rateLimiter = new RateLimiter();
