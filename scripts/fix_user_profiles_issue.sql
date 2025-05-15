-- Fix user profile creation by completely recreating the trigger and function

-- 1. Drop existing trigger and function if they exist
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 2. Create the handle_new_user function with correct column mapping
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (
    id, 
    username, 
    full_name, 
    avatar_url, 
    country, 
    created_at, 
    updated_at,
    correct_answers_count,
    correct_answers_today,
    correct_answers_week,
    correct_answers_month,
    streak,
    longest_streak
  )
  VALUES (
    NEW.id,
    NEW.email,  -- Default username to email
    NEW.raw_user_meta_data->>'full_name', -- Extract from metadata if available
    NEW.raw_user_meta_data->>'avatar_url', -- Extract from metadata if available
    NEW.raw_user_meta_data->>'country', -- Extract country from metadata if available
    NOW(),
    NOW(),
    0,  -- correct_answers_count
    0,  -- correct_answers_today
    0,  -- correct_answers_week
    0,  -- correct_answers_month
    0,  -- streak
    0   -- longest_streak
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create the trigger to run after new user creation
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- 4. Find users without profiles and create them
INSERT INTO public.user_profiles (
  id, 
  username, 
  full_name, 
  avatar_url, 
  country, 
  created_at, 
  updated_at,
  correct_answers_count,
  correct_answers_today,
  correct_answers_week,
  correct_answers_month,
  streak,
  longest_streak
)
SELECT 
  u.id,
  u.email,
  u.raw_user_meta_data->>'full_name',
  u.raw_user_meta_data->>'avatar_url',
  u.raw_user_meta_data->>'country',
  NOW(),
  NOW(),
  0, 0, 0, 0, 0, 0
FROM 
  auth.users u
LEFT JOIN 
  public.user_profiles p ON u.id = p.id
WHERE 
  p.id IS NULL;

-- 5. Report what was done
DO $$
DECLARE
  profiles_created INTEGER;
BEGIN
  SELECT COUNT(*) INTO profiles_created 
  FROM auth.users u 
  LEFT JOIN public.user_profiles p ON u.id = p.id 
  WHERE p.id IS NULL;
  
  RAISE NOTICE 'Function and trigger recreated. % missing profiles created.', profiles_created;
END $$; 