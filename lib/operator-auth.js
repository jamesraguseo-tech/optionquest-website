import { getSupabaseAdmin } from './supabase-admin.js';

/**
 * Fail-closed server-side operator authentication & authorization guard.
 * Strictly queries the authoritative public.operators PostgreSQL table.
 * Rejects client-supplied metadata (CWE-285 anti-JIT trust).
 *
 * @param {import('http').IncomingMessage} req
 * @param {{ requireSuperAdmin?: boolean }} options
 * @returns {Promise<{ success: boolean, status?: number, error?: string, context?: any }>}
 */
export async function requireOperatorAuth(req, options = { requireSuperAdmin: false }) {
  const authHeader = (req.headers && (req.headers['authorization'] || req.headers['Authorization'])) || '';

  if (!authHeader.startsWith('Bearer ')) {
    return {
      success: false,
      status: 401,
      error: 'Unauthorized: Missing or invalid Bearer token.',
    };
  }

  const token = authHeader.slice(7).trim();
  const supabaseAdmin = await getSupabaseAdmin();

  if (!supabaseAdmin) {
    console.error('[Operator Auth] Supabase admin client configuration missing.');
    return {
      success: false,
      status: 500,
      error: 'Server configuration error: Authentication service unconfigured.',
    };
  }

  // 1. Verify cryptographic JWT signature with Supabase Auth
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user?.email) {
    return {
      success: false,
      status: 401,
      error: 'Unauthorized: Invalid or expired session.',
    };
  }

  const cleanEmail = user.email.toLowerCase().trim();

  // 2. Query authoritative operators database table
  const { data: operatorRecord, error: dbError } = await supabaseAdmin
    .from('operators')
    .select('id, email, role, is_active')
    .eq('email', cleanEmail)
    .maybeSingle();

  // Break-glass root administrator fallback
  const isRootAdmin = Boolean(
    process.env.ROOT_ADMIN_EMAIL &&
    cleanEmail === process.env.ROOT_ADMIN_EMAIL.toLowerCase().trim() &&
    (user.email_confirmed_at || user.confirmed_at)
  );

  // 3. Fail closed if record is missing
  if (!operatorRecord) {
    if (isRootAdmin) {
      return {
        success: true,
        context: {
          user: { id: user.id, email: cleanEmail },
          operator: { id: user.id, email: cleanEmail, role: 'super_admin', is_active: true },
          isAdmin: true,
          isRootAdmin: true,
        },
      };
    }

    return {
      success: false,
      status: 403,
      error: 'Forbidden: Account is not an authorized operator.',
    };
  }

  // 4. Verify account is active (Layer 1 Application Guard)
  if (!operatorRecord.is_active) {
    return {
      success: false,
      status: 403,
      error: 'Forbidden: Operator account has been deactivated.',
    };
  }

  const isSuperAdmin = operatorRecord.role === 'super_admin' || isRootAdmin;

  // 5. Enforce super-admin requirement if requested
  if (options.requireSuperAdmin && !isSuperAdmin) {
    return {
      success: false,
      status: 403,
      error: 'Forbidden: Super administrator privileges required.',
    };
  }

  return {
    success: true,
    context: {
      user: { id: user.id, email: cleanEmail },
      operator: operatorRecord,
      isAdmin: true,
      isSuperAdmin,
    },
  };
}
