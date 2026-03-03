/**
 * Simple concurrency limiter with optional rate limiting.
 * 
 * - MAX_CONCURRENT: Maximum requests in-flight simultaneously
 * - RATE_LIMIT_PER_SECOND: Maximum requests per second (uses token bucket)
 */

const MAX_CONCURRENT = 2;
const RATE_LIMIT_PER_SECOND = 5;
const TOKEN_REFILL_INTERVAL_MS = 1000 / RATE_LIMIT_PER_SECOND; // 100ms per token

let activeRequests = 0;
let tokens = RATE_LIMIT_PER_SECOND; // Start with full bucket
let lastRefillTime = Date.now();

const concurrencyQueue: Array<() => void> = [];
const rateLimitQueue: Array<() => void> = [];

/**
 * Refill tokens based on elapsed time (token bucket algorithm)
 */
function refillTokens(): void {
  const now = Date.now();
  const elapsed = now - lastRefillTime;
  const tokensToAdd = Math.floor(elapsed / TOKEN_REFILL_INTERVAL_MS);
  
  if (tokensToAdd > 0) {
    tokens = Math.min(RATE_LIMIT_PER_SECOND, tokens + tokensToAdd);
    lastRefillTime = now;
  }
}

/**
 * Process the rate limit queue if tokens are available
 */
function processRateLimitQueue(): void {
  refillTokens();
  
  while (rateLimitQueue.length > 0 && tokens > 0) {
    tokens--;
    const next = rateLimitQueue.shift();
    next?.();
  }
  
  // If there are still items in queue, schedule next check
  if (rateLimitQueue.length > 0) {
    setTimeout(processRateLimitQueue, TOKEN_REFILL_INTERVAL_MS);
  }
}

/**
 * Wait for a rate limit token
 */
async function acquireRateLimitToken(): Promise<void> {
  refillTokens();
  
  if (tokens > 0) {
    tokens--;
    return;
  }
  
  // Wait in queue for a token
  return new Promise<void>(resolve => {
    rateLimitQueue.push(resolve);
    // Ensure queue processing is scheduled
    if (rateLimitQueue.length === 1) {
      setTimeout(processRateLimitQueue, TOKEN_REFILL_INTERVAL_MS);
    }
  });
}

/**
 * Wait for a concurrency slot
 */
async function acquireConcurrencySlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT) {
    activeRequests++;
    return;
  }
  
  return new Promise<void>(resolve => {
    concurrencyQueue.push(() => {
      activeRequests++;
      resolve();
    });
  });
}

/**
 * Release a concurrency slot
 */
function releaseConcurrencySlot(): void {
  activeRequests--;
  const next = concurrencyQueue.shift();
  next?.();
}

/**
 * Execute a function with concurrency and rate limiting.
 * 
 * - Limits to MAX_CONCURRENT simultaneous requests
 * - Limits to RATE_LIMIT_PER_SECOND requests per second
 * 
 * @param fn - Async function to execute
 * @returns Promise resolving to the function's result
 */
export async function withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  // First acquire rate limit token (respects 10/sec)
  await acquireRateLimitToken();
  
  // Then acquire concurrency slot (respects 5 concurrent)
  await acquireConcurrencySlot();
  
  try {
    return await fn();
  } finally {
    releaseConcurrencySlot();
  }
}

/**
 * Execute multiple functions with concurrency limiting.
 * Like Promise.all but respects concurrency and rate limits.
 *
 * @param fns - Array of async functions to execute
 * @returns Promise resolving to array of results
 */
export async function allWithConcurrencyLimit<T>(
  fns: Array<() => Promise<T>>
): Promise<T[]> {
  return Promise.all(fns.map(fn => withConcurrencyLimit(fn)));
}

/**
 * Execute async tasks sequentially with a fixed delay between each.
 * Use this instead of Promise.all when the server can't handle concurrent requests.
 *
 * @param items - Items to process
 * @param fn - Async function to call for each item
 * @param delayMs - Delay in ms between each call (default 10ms)
 * @returns Promise resolving to array of results
 */
export async function sequentialWithDelay<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  delayMs: number = 10
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i++) {
    results.push(await fn(items[i]));
    if (i < items.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return results;
}

/**
 * Get current limiter stats (for debugging)
 */
export function getConcurrencyStats(): {
  activeRequests: number;
  concurrencyQueueLength: number;
  rateLimitQueueLength: number;
  availableTokens: number;
} {
  refillTokens();
  return {
    activeRequests,
    concurrencyQueueLength: concurrencyQueue.length,
    rateLimitQueueLength: rateLimitQueue.length,
    availableTokens: tokens,
  };
}

// Transient HTTP errors that should be retried
const RETRYABLE_STATUS_CODES = [429, 502, 503, 504];

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  context?: string; // For logging
}

/**
 * Checks if an error is retryable (transient server error)
 */
export function isRetryableError(error: any): boolean {
  // Check for HTTP status codes in error message
  if (error?.message) {
    for (const code of RETRYABLE_STATUS_CODES) {
      if (error.message.includes(`${code}`) || error.message.includes(`status ${code}`)) {
        return true;
      }
    }
    // Check for timeout/overload messages
    if (error.message.includes('timeout') ||
        error.message.includes('overload') ||
        error.message.includes('rate limit') ||
        error.message.includes('Too Many Requests')) {
      return true;
    }
  }
  // Check for Response objects
  if (error?.status && RETRYABLE_STATUS_CODES.includes(error.status)) {
    return true;
  }
  return false;
}

/**
 * Checks if an HTTP response status is retryable
 */
export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.includes(status);
}

/**
 * Execute a function with retry logic for transient failures.
 * Uses exponential backoff with jitter.
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration
 * @returns Promise resolving to the function's result
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    context = 'operation',
  } = options;

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Don't retry if not a transient error or last attempt
      if (!isRetryableError(error) || attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff with jitter: delay = min(baseDelay * 2^attempt + jitter, maxDelay)
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * 1000;
      const delay = Math.min(exponentialDelay + jitter, maxDelayMs);

      console.log(
        `⏳ Retry ${attempt + 1}/${maxRetries} for ${context} after ${Math.round(delay)}ms ` +
        `(${error?.message?.substring(0, 100) || 'Unknown error'})`
      );

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
