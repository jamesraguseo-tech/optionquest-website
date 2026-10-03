-- OptionQuest: Player Profiles Table for Zero-PII Cloud Sync
-- Associated with Issue #39 (Bundle 3 / Build 14)

CREATE TABLE IF NOT EXISTS public.player_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  avatar_id TEXT DEFAULT 'user',
  xp INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  quest_coins INTEGER DEFAULT 0,
  streak INTEGER DEFAULT 0,
  unlocked_features JSONB DEFAULT '[]'::jsonb,
  completed_lessons JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row-Level Security
ALTER TABLE public.player_profiles ENABLE ROW LEVEL SECURITY;

-- Enforce strict self-access: Anonymous auth users can ONLY read and write their own profile
CREATE POLICY "Users can view their own profile"
  ON public.player_profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.player_profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.player_profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
