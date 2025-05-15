-- Script to manually create missing user profiles for existing users

-- First, identify users without profiles
WITH missing_profiles AS (
  SELECT 
    u.id,
    u.email,
    u.raw_user_meta_data
  FROM auth.users u
  LEFT JOIN public.user_profiles p ON u.id = p.id
  WHERE p.id IS NULL
)

-- Insert missing profiles
INSERT INTO public.user_profiles (id, username, full_name, avatar_url, created_at, updated_at)
SELECT 
  id,
  email, -- Default username to email
  raw_user_meta_data->>'full_name', -- Extract from metadata if available
  raw_user_meta_data->>'avatar_url', -- Extract from metadata if available
  NOW(),
  NOW()
FROM missing_profiles
RETURNING id, username;

-- Verify trigger is active for future users
DO $$
BEGIN
  -- Check if trigger exists
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_trigger 
    WHERE tgname = 'on_auth_user_created'
  ) THEN
    -- Recreate the trigger if missing
    EXECUTE 'CREATE OR REPLACE TRIGGER on_auth_user_created
             AFTER INSERT ON auth.users
             FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()';
    
    RAISE NOTICE 'Trigger on_auth_user_created was missing and has been recreated';
  ELSE
    RAISE NOTICE 'Trigger on_auth_user_created exists';
  END IF;
  
  -- Check if function exists
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_proc 
    WHERE proname = 'handle_new_user'
  ) THEN
    -- Recreate the function if missing
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.handle_new_user()
      RETURNS TRIGGER AS $$
      BEGIN
        INSERT INTO public.user_profiles (id, username, full_name, avatar_url)
        VALUES (
          NEW.id,
          NEW.email,  -- Default username to email
          NEW.raw_user_meta_data->>'full_name', -- Extract from metadata if available
          NEW.raw_user_meta_data->>'avatar_url' -- Extract from metadata if available
        );
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    $f$;
    
    RAISE NOTICE 'Function handle_new_user was missing and has been recreated';
  ELSE
    RAISE NOTICE 'Function handle_new_user exists';
  END IF;
END $$; 