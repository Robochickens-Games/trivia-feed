-- Check if the trigger for creating user profiles exists
SELECT 
  tgname AS trigger_name,
  pg_get_triggerdef(oid) AS trigger_definition
FROM pg_trigger
WHERE tgname = 'on_auth_user_created';

-- Check if the function for handling new users exists
SELECT 
  proname AS function_name,
  pg_get_functiondef(oid) AS function_definition
FROM pg_proc
WHERE proname = 'handle_new_user';

-- Check if any user profiles exist (to test if trigger is working)
SELECT COUNT(*) AS profile_count
FROM public.user_profiles;

-- Check if any auth.users exist without profiles (to identify missing profiles)
SELECT 
  COUNT(*) AS missing_profiles_count
FROM auth.users u
LEFT JOIN public.user_profiles p ON u.id = p.id
WHERE p.id IS NULL;
