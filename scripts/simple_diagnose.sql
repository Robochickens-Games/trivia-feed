-- Simple diagnostic script to identify signup issues (minimal version)

-- 1. Check table structure of user_profiles
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM 
  information_schema.columns 
WHERE 
  table_name = 'user_profiles'
ORDER BY ordinal_position;

-- 2. Check if handle_new_user function exists
SELECT EXISTS (
  SELECT 1 FROM pg_proc WHERE proname = 'handle_new_user'
) AS function_exists;

-- 3. Check if the trigger exists and is enabled
SELECT EXISTS (
  SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
) AS trigger_exists;

SELECT 
  tgname,
  tgenabled
FROM 
  pg_trigger
WHERE 
  tgname = 'on_auth_user_created';

-- 4. Check for users without profiles (this is the key issue)
SELECT 
  COUNT(*) AS total_users
FROM 
  auth.users;

SELECT 
  COUNT(*) AS users_without_profiles
FROM 
  auth.users u
LEFT JOIN 
  public.user_profiles p ON u.id = p.id
WHERE 
  p.id IS NULL;

-- 5. Check for most recently created users and their profile status
SELECT 
  u.id,
  u.email,
  u.created_at,
  CASE WHEN p.id IS NULL THEN 'Missing' ELSE 'Exists' END AS profile_status
FROM 
  auth.users u
LEFT JOIN 
  public.user_profiles p ON u.id = p.id
ORDER BY 
  u.created_at DESC
LIMIT 5; 