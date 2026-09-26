import crypto from 'crypto';

let supabaseAdminClient;

/**
 * Returns a privileged Supabase client using SUPABASE_SERVICE_ROLE_KEY.
 * Lazily loads @supabase/supabase-js so modules load safely if unconfigured.
 *
 * @returns {Promise<any | null>}
 */
export async function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  if (!supabaseAdminClient) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      supabaseAdminClient = createClient(supabaseUrl, serviceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
    } catch (err) {
      console.error('[Supabase Admin Init Error]', err);
      return null;
    }
  }

  return supabaseAdminClient;
}

/**
 * Paginates through Supabase Auth users to locate a target email without silent 50-user truncation.
 *
 * @param {any} supabaseAdmin
 * @param {string} email
 * @returns {Promise<any | null>}
 */
export async function findAuthUserByEmail(supabaseAdmin, email) {
  if (!email || !supabaseAdmin) return null;
  const target = email.toLowerCase().trim();
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error || !data || !Array.isArray(data.users) || data.users.length === 0) {
      break;
    }
    const found = data.users.find((u) => u.email && u.email.toLowerCase().trim() === target);
    if (found) return found;
    if (data.users.length < perPage) break;
    page++;
  }
  return null;
}

/**
 * NIST SP 800-63B compliant cryptographic temporary password generator.
 * Excludes ambiguous characters (I, O, l, 0, 1) and ensures balanced character entropy.
 *
 * @param {number} length
 * @returns {string}
 */
export function generateSecureTemporaryPassword(length = 24) {
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // omitted ambiguous I, O
  const lowercase = 'abcdefghijkmnopqrstuvwxyz'; // omitted ambiguous l
  const numbers = '23456789'; // omitted ambiguous 0, 1
  const symbols = '!@#$%^&*()-_=+[]{}';
  const allChars = uppercase + lowercase + numbers + symbols;

  // Guarantee at least one character from each required set
  const passwordChars = [
    uppercase[crypto.randomInt(0, uppercase.length)],
    lowercase[crypto.randomInt(0, lowercase.length)],
    numbers[crypto.randomInt(0, numbers.length)],
    symbols[crypto.randomInt(0, symbols.length)],
  ];

  // Fill remaining length from CSPRNG
  for (let i = 4; i < length; i++) {
    passwordChars.push(allChars[crypto.randomInt(0, allChars.length)]);
  }

  // Fisher-Yates cryptographic shuffle
  for (let i = passwordChars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    const temp = passwordChars[i];
    passwordChars[i] = passwordChars[j];
    passwordChars[j] = temp;
  }

  return passwordChars.join('');
}
