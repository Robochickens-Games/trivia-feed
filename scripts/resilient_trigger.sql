-- Create a more resilient trigger function that handles errors gracefully

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Create a simplified version of the function with robust error handling
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Log the attempt
  RAISE LOG 'Attempting to create user profile for user ID: %', NEW.id;
  
  -- Check if profile already exists to avoid duplicate key errors
  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE id = NEW.id) THEN
    RAISE LOG 'Profile already exists for user %', NEW.id;
    RETURN NEW;
  END IF;

  -- Try with minimal fields first to reduce chance of errors
  BEGIN
    INSERT INTO public.user_profiles (id, username, created_at, updated_at)
    VALUES (
      NEW.id,
      COALESCE(NEW.email, 'user_' || NEW.id),
      NOW(),
      NOW()
    );
    RAISE LOG 'Successfully created basic profile for user %', NEW.id;
  EXCEPTION
    WHEN others THEN
      -- Log the error but don't prevent user creation
      RAISE LOG 'Error creating profile for user % (basic fields): %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Create the trigger
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- Make sure permissions are set correctly
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
GRANT ALL ON public.user_profiles TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authenticated, anon, service_role;

-- Create function to manually create profiles for existing users
CREATE OR REPLACE FUNCTION public.create_missing_profiles()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  missing_count INTEGER := 0;
  success_count INTEGER := 0;
  user_record RECORD;
BEGIN
  -- Find users without profiles
  FOR user_record IN 
    SELECT u.id, u.email
    FROM auth.users u
    LEFT JOIN public.user_profiles p ON u.id = p.id
    WHERE p.id IS NULL
  LOOP
    BEGIN
      INSERT INTO public.user_profiles (id, username, created_at, updated_at)
      VALUES (
        user_record.id,
        COALESCE(user_record.email, 'user_' || user_record.id),
        NOW(),
        NOW()
      );
      success_count := success_count + 1;
    EXCEPTION
      WHEN others THEN
        missing_count := missing_count + 1;
        RAISE LOG 'Failed to create profile for user %: %', user_record.id, SQLERRM;
    END;
  END LOOP;
  
  RETURN format('Created %s profiles, failed to create %s profiles', success_count, missing_count);
END;
$$;

-- Grant execute permission on the function
GRANT EXECUTE ON FUNCTION public.create_missing_profiles() TO service_role; 