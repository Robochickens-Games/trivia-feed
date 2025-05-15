-- Simplified fix for user signup issues
-- This script focuses only on the essential changes needed

-- 1. Create a simplified version of the trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Very simple minimal implementation
  INSERT INTO public.user_profiles (id, username)
  VALUES (NEW.id, COALESCE(NEW.email, 'user_' || NEW.id));
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log but don't fail
    RAISE NOTICE 'Error creating profile: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- 2. Disable old trigger and create new one
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- 3. Fix any missing profiles
INSERT INTO public.user_profiles (id, username)
SELECT 
  u.id, 
  COALESCE(u.email, 'user_' || u.id)
FROM 
  auth.users u
LEFT JOIN 
  public.user_profiles p ON u.id = p.id
WHERE 
  p.id IS NULL
ON CONFLICT (id) DO NOTHING; 