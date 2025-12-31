interface TokenCache {
  token: string;
  expiresAt: number; // Unix timestamp
}

let tokenCache: TokenCache | null = null;
let tokenFetchPromise: Promise<string> | null = null;

export async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60000) {
    return tokenCache.token;
  }

  // If already fetching, wait for that request
  if (tokenFetchPromise) {
    return tokenFetchPromise;
  }

  // Start new token fetch
  tokenFetchPromise = fetchNewToken();

  try {
    const token = await tokenFetchPromise;
    return token;
  } finally {
    tokenFetchPromise = null;
  }
}

async function fetchNewToken(): Promise<string> {
  const tokenUrl = process.env.ACCESS_TOKEN_URL;
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;

  if (!tokenUrl || !clientId || !clientSecret) {
    throw new Error(
      'OAuth configuration missing. Check environment variables.'
    );
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OAuth token request failed: ${response.status} ${errorText}`
    );
  }

  const data = await response.json();

  // Cache the token
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}
