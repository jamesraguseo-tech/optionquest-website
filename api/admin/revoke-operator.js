import { requireOperatorAuth } from '../../lib/operator-auth.js';
import { getSupabaseAdmin } from '../../lib/supabase-admin.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://playoptionquest.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Enforce super-admin operator authorization
  const auth = await requireOperatorAuth(req, { requireSuperAdmin: true });
  if (!auth.success) {
    return res.status(auth.status || 403).json({ error: auth.error });
  }

  const { targetUserId } = req.body || {};
  if (!targetUserId || typeof targetUserId !== 'string') {
    return res.status(400).json({ error: 'Target user ID is required.' });
  }

  const supabaseAdmin = await getSupabaseAdmin();
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Database service configuration missing.' });
  }

  try {
    // 2. Layer 1: Application-level deactivation in public.operators table
    const { error: dbError } = await supabaseAdmin
      .from('operators')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', targetUserId);

    if (dbError) {
      console.error('[Admin Revoke Error] DB update failed:', dbError);
      return res.status(500).json({ error: 'Failed to deactivate operator record.' });
    }

    // 3. Layer 2: Auth Gateway ban via GoTrue (invalidates all future token refreshes)
    const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
      ban_duration: '876000h', // ~100 years
    });

    if (banError) {
      console.error('[Admin Revoke Error] GoTrue ban failed:', banError);
      return res.status(500).json({ error: 'Failed to revoke GoTrue session tokens.' });
    }

    return res.status(200).json({
      success: true,
      deactivated: true,
      targetUserId,
      revocation: 'two-layer-enforced',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Admin Revoke Unexpected Error]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
