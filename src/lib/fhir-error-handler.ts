/**
 * FHIR API Error Handler
 * Provides standardized error handling for FHIR terminology service responses
 */

export type ErrorBehavior = 'THROW' | 'RETURN_EMPTY' | 'RETURN_NULL';

interface ErrorConfig {
  message: string;
  behavior: ErrorBehavior;
  shouldLog?: boolean;
}

/**
 * Standard FHIR/HTTP error configurations
 * Maps status codes to error messages and behaviors
 */
const ERROR_CONFIGS: Record<number, ErrorConfig> = {
  401: {
    message: 'Authentication failed (401): Invalid or expired OAuth token. Please check your credentials.',
    behavior: 'THROW',
  },
  403: {
    message: 'Access forbidden (403): Your account does not have permission to access the terminology server.',
    behavior: 'THROW',
  },
  404: {
    message: 'Resource not found (404)',
    behavior: 'RETURN_EMPTY', // Default - can be overridden per call
  },
  414: {
    message: 'Request URI too long (414): ECL query exceeded URL length limit. This may indicate a batching issue.',
    behavior: 'THROW',
  },
  422: {
    message: 'Unprocessable Entity (422): The request was well-formed but contains semantic errors.',
    behavior: 'THROW',
  },
  429: {
    message: 'Rate limited (429): Too many requests to terminology server. Please try again later.',
    behavior: 'THROW',
  },
};

/**
 * Custom error class for FHIR API errors
 */
export class FhirApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message: string,
    public details?: string
  ) {
    super(message);
    this.name = 'FhirApiError';
  }
}

export interface HandleResponseOptions {
  /** Override behavior for specific status codes */
  overrides?: Partial<Record<number, ErrorBehavior>>;
  /** Context string for logging (e.g., "expanding ValueSet", "translating code") */
  context?: string;
}

/**
 * Handles FHIR API response errors in a standardized way
 *
 * @param response - The fetch Response object
 * @param options - Options to customize error handling behavior
 * @returns null for RETURN_NULL behavior, empty array for RETURN_EMPTY, or throws for THROW
 *
 * @example
 * ```typescript
 * const response = await fetch(url);
 * await handleFhirResponse(response, {
 *   overrides: { 404: 'RETURN_EMPTY' },
 *   context: 'expanding ValueSet'
 * });
 * ```
 */
export async function handleFhirResponse(
  response: Response,
  options: HandleResponseOptions = {}
): Promise<null | []> {
  if (response.ok) {
    return null; // No error
  }

  const errorText = await response.text();
  const status = response.status;
  const { overrides = {}, context } = options;

  // Get the error configuration for this status code
  let config = ERROR_CONFIGS[status];

  // Apply behavior override if provided
  if (config && overrides[status]) {
    config = { ...config, behavior: overrides[status]! };
  }

  // Handle 5xx server errors
  if (status >= 500) {
    const errorDetails = {
      status,
      statusText: response.statusText,
      error: errorText.substring(0, 500),
      context,
    };
    console.error('FHIR server error:', errorDetails);

    throw new FhirApiError(
      status,
      response.statusText,
      `Terminology server error (${status}): ${response.statusText}. The server may be experiencing issues.`,
      errorText
    );
  }

  // Handle known 4xx client errors
  if (config) {
    const fullMessage = config.message + (errorText ? ` ${errorText.substring(0, 200)}` : '');

    if (config.shouldLog !== false) {
      const logLevel = config.behavior === 'THROW' ? console.error : console.warn;
      logLevel(`FHIR API ${status}${context ? ` (${context})` : ''}:`, fullMessage);
    }

    switch (config.behavior) {
      case 'RETURN_EMPTY':
        return [];
      case 'RETURN_NULL':
        return null;
      case 'THROW':
        throw new FhirApiError(status, response.statusText, fullMessage, errorText);
    }
  }

  // Handle unknown 4xx errors
  const errorDetails = {
    status,
    statusText: response.statusText,
    error: errorText.substring(0, 500),
    context,
  };
  console.error('Unexpected FHIR API error:', errorDetails);

  throw new FhirApiError(
    status,
    response.statusText,
    `Terminology server request failed: ${status} ${response.statusText}. ${errorText.substring(0, 200)}`,
    errorText
  );
}

/**
 * Helper to check if an error is a FHIR API error
 */
export function isFhirApiError(error: unknown): error is FhirApiError {
  return error instanceof FhirApiError;
}
