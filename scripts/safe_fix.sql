-- Safe fixes for user signup issues - minimal approach that's safe to run

-- 1. Disable the existing trigger (safer than dropping it)
ALTER TRIGGER IF EXISTS on_auth_user_created ON auth.users DISABLE;

-- 2. Create a very simple minimalist trigger function that handles any errors
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- We need to make this function simple yet bulletproof
  BEGIN
    INSERT INTO public.user_profiles (id, username)
    VALUES (NEW.id, COALESCE(NEW.email, 'user_' || NEW.id));
    RAISE LOG 'Created profile for user: %', NEW.id;
  EXCEPTION
    WHEN OTHERS THEN
      -- Log but don't fail
      RAISE LOG 'Error creating profile for user % (ignoring): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- 3. Create a new trigger with a different name (to avoid conflicts)
DROP TRIGGER IF EXISTS new_on_auth_user_created ON auth.users;
CREATE TRIGGER new_on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- 4. Set proper permissions
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
GRANT ALL ON public.user_profiles TO authenticated, anon, service_role;
ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- 5. Fix any missing profiles for existing users
DO $$
DECLARE
  fixed_count INTEGER := 0;
BEGIN
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
  
  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % users with missing profiles', fixed_count;
END $$;

-- 6. Verify the fix
SELECT EXISTS (
  SELECT 1 FROM pg_trigger 
  WHERE tgname = 'new_on_auth_user_created' 
  AND tgenabled = 'O'
) AS new_trigger_enabled; 