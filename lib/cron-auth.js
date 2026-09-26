/**
 * Constant-time string equality check to prevent side-channel timing attacks.
 * Operates universally across Node.js Serverless and Vercel Edge Runtime.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Validates Bearer token in request against CRON_SECRET environment variable.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {{ success: boolean, status?: number, error?: string }}
 */
export function requireCronAuth(req) {
  const authHeader = (req.headers && (req.headers['authorization'] || req.headers['Authorization'])) || '';
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    console.error('[Cron Auth] CRON_SECRET is not configured in server environment variables.');
    return {
      success: false,
      status: 500,
      error: 'Server configuration error: Cron secret not configured.',
    };
  }

  const prefix = 'Bearer ';
  if (!authHeader.startsWith(prefix)) {
    return {
      success: false,
      status: 401,
      error: 'Unauthorized: Missing or invalid Bearer authorization scheme.',
    };
  }

  const providedToken = authHeader.slice(prefix.length).trim();

  if (!constantTimeCompare(providedToken, expectedSecret)) {
    return {
      success: false,
      status: 401,
      error: 'Unauthorized: Invalid cron authorization token.',
    };
  }

  return { success: true };
}
