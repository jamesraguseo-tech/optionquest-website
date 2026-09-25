-- Migration: 20260925000000_create_operators_table.sql
-- Purpose: Fail-closed operator RBAC with zero client-metadata trust and Oct 30 explicit Data API grants (Issue #38)

CREATE TABLE IF NOT EXISTS public.operators (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'operator', 'moderator')),
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 1. Enable Row-Level Security
ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;

-- 2. Drop any existing permissive policies
DROP POLICY IF EXISTS "Public Read" ON public.operators;
DROP POLICY IF EXISTS "Public Write" ON public.operators;

-- 3. Fail-closed default: Deny-all public access
CREATE POLICY "Operators deny-all public" ON public.operators
  FOR ALL USING (false);

-- 4. Service role has full administrative management
CREATE POLICY "Service role full access on operators" ON public.operators
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 5. Active super_admins can view or manage the operator roster
CREATE POLICY "Super admin manage operators" ON public.operators
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.operators
      WHERE id = auth.uid() AND role = 'super_admin' AND is_active = true
    )
  );

-- 6. Operators can view their own record
CREATE POLICY "Operators can view own profile" ON public.operators
  FOR SELECT TO authenticated
  USING (
    email = (auth.jwt() ->> 'email') OR id = auth.uid()
  );

-- 7. Explicit Data API role grants (Mandatory post-Oct 30, per Issue #38)
GRANT SELECT ON public.operators TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operators TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operators TO service_role;
