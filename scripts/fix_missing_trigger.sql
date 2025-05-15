-- Script to check and recreate the trigger for user profile creation if missing

DO $$
BEGIN
  -- Check if the function exists
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_proc 
    WHERE proname = 'handle_new_user'
  ) THEN
    -- The handle_new_user function doesn't exist, create it
    RAISE NOTICE 'Creating handle_new_user function...';
    
    EXECUTE $func$
      CREATE OR REPLACE FUNCTION public.handle_new_user()
      RETURNS TRIGGER AS $BODY$
      BEGIN
        INSERT INTO public.user_profiles (id, username, full_name, avatar_url, country, created_at, updated_at)
        VALUES (
          NEW.id,
          NEW.email,  -- Default username to email
          NEW.raw_user_meta_data->>'full_name', -- Extract from metadata if available
          NEW.raw_user_meta_data->>'avatar_url', -- Extract from metadata if available
          NEW.raw_user_meta_data->>'country', -- Extract country from metadata if available
          NOW(),
          NOW()
        );
        RETURN NEW;
      END;
      $BODY$ LANGUAGE plpgsql SECURITY DEFINER;
    $func$;
    
    RAISE NOTICE 'Function handle_new_user created successfully';
  ELSE
    RAISE NOTICE 'Function handle_new_user already exists';
  END IF;

  -- Check if the trigger exists
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_trigger 
    WHERE tgname = 'on_auth_user_created'
  ) THEN
    -- The trigger doesn't exist, create it
    RAISE NOTICE 'Creating on_auth_user_created trigger...';
    
    EXECUTE $trig$
      CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_new_user();
    $trig$;
    
    RAISE NOTICE 'Trigger on_auth_user_created created successfully';
  ELSE
    RAISE NOTICE 'Trigger on_auth_user_created already exists';
  END IF;
END;
$$;

-- Create a function to manually create a profile for a specific user ID
CREATE OR REPLACE FUNCTION public.create_missing_profile(user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_email TEXT;
  user_meta JSONB;
BEGIN
  -- Get the user's email and metadata from auth.users
  SELECT email, raw_user_meta_data
  INTO user_email, user_meta
  FROM auth.users
  WHERE id = user_id;
  
  IF user_email IS NULL THEN
    RAISE EXCEPTION 'User with ID % not found', user_id;
  END IF;
  
  -- Check if profile already exists
  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE id = user_id) THEN
    RAISE NOTICE 'Profile already exists for user %', user_id;
    RETURN;
  END IF;
  
  -- Create the profile
  INSERT INTO public.user_profiles (id, username, full_name, avatar_url, country, created_at, updated_at)
  VALUES (
    user_id,
    user_email,
    user_meta->>'full_name',
    user_meta->>'avatar_url',
    user_meta->>'country',
    NOW(),
    NOW()
  );
  
  RAISE NOTICE 'Profile created for user % (%)', user_id, user_email;
END;
$$;

-- Grant execution permission on the create_missing_profile function
GRANT EXECUTE ON FUNCTION public.create_missing_profile(UUID) TO service_role;
COMMENT ON FUNCTION public.create_missing_profile(UUID) IS 'Creates a user profile for an existing auth.users entry'; 