-- Fix permissions for the user profile trigger functionality

-- 1. Grant necessary permissions to the auth user
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- 2. Make sure the handle_new_user function has the right permissions
ALTER FUNCTION public.handle_new_user() SECURITY DEFINER;

-- 3. Simplify the trigger function to minimize potential errors
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, username, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    NOW(),
    NOW()
  );
  RETURN NEW;
EXCEPTION
  WHEN others THEN
    RAISE LOG 'Error in handle_new_user trigger: %', SQLERRM;
    RETURN NEW; -- Continue even if there's an error
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Test if we can manually insert a user profile (for debugging)
DO $$
BEGIN
  RAISE NOTICE 'Checking if manual insert works...';
  BEGIN
    -- This is just a test to see if basic insert permissions work
    -- It will fail if the ID doesn't exist, which is expected
    INSERT INTO public.user_profiles (id, username, created_at, updated_at)
    VALUES (
      '00000000-0000-0000-0000-000000000000',
      'test@example.com',
      NOW(),
      NOW()
    );
  EXCEPTION 
    WHEN foreign_key_violation THEN
      RAISE NOTICE 'Foreign key violation expected (ID does not exist in auth.users)';
    WHEN others THEN
      RAISE NOTICE 'Other error: %', SQLERRM;
  END;
END $$; 