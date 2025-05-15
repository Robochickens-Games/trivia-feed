-- Script to verify that the fix worked

-- 1. Check if the new trigger is active
SELECT 
  tgname AS trigger_name,
  tgenabled AS trigger_enabled,
  pg_get_triggerdef(oid) AS trigger_definition
FROM 
  pg_trigger
WHERE 
  tgname = 'new_on_auth_user_created'
  OR tgname = 'on_auth_user_created';

-- 2. Check for users without profiles
SELECT 
  COUNT(*) AS users_without_profiles
FROM 
  auth.users u
LEFT JOIN 
  public.user_profiles p ON u.id = p.id
WHERE 
  p.id IS NULL;

-- 3. Show the most recent users with their profile status
SELECT 
  u.id,
  u.email,
  u.created_at,
  u.last_sign_in_at,
  CASE WHEN p.id IS NULL THEN 'Missing' ELSE 'Exists' END AS profile_status
FROM 
  auth.users u
LEFT JOIN 
  public.user_profiles p ON u.id = p.id
ORDER BY 
  u.created_at DESC
LIMIT 10;

-- 4. Test the trigger function manually with a simulated user
-- (Just testing, will roll back the transaction)
BEGIN;

DO $$
DECLARE
  test_uuid UUID := uuid_generate_v4();
  result RECORD;
BEGIN
  RAISE NOTICE 'Testing trigger with UUID: %', test_uuid;
  
  -- Simulate inserting a user (this won't actually work due to FK constraints)
  -- but we can at least test the function directly
  PERFORM public.handle_new_user();
  
  -- Check if the trigger function throws any errors
  BEGIN
    SELECT * FROM public.handle_new_user();
    RAISE NOTICE 'Function executed without errors';
  EXCEPTION
    WHEN others THEN
      RAISE NOTICE 'Function execution failed: %', SQLERRM;
  END;
END $$;

ROLLBACK; 