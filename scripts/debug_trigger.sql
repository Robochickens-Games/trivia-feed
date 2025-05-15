-- Check if the trigger exists
SELECT 
  tgname AS trigger_name,
  pg_get_triggerdef(oid) AS trigger_definition
FROM pg_trigger
WHERE tgname = 'on_auth_user_created';

-- Check if the function exists
SELECT 
  proname AS function_name,
  pg_get_functiondef(oid) AS function_definition
FROM pg_proc
WHERE proname = 'handle_new_user';

-- Get the current structure of the user_profiles table
SELECT 
  column_name, 
  data_type, 
  is_nullable 
FROM 
  information_schema.columns 
WHERE 
  table_name = 'user_profiles';

-- List auth.users with missing profiles
SELECT 
  u.id, 
  u.email, 
  u.created_at,
  'Missing profile' AS issue 
FROM 
  auth.users u
LEFT JOIN 
  public.user_profiles p ON u.id = p.id
WHERE 
  p.id IS NULL;

-- List all auth.users (without sensitive info)
SELECT 
  id, 
  email, 
  created_at, 
  updated_at, 
  CASE WHEN last_sign_in_at IS NULL THEN 'Never' ELSE 'Yes' END AS has_signed_in
FROM 
  auth.users 
ORDER BY 
  created_at DESC 
LIMIT 10;
