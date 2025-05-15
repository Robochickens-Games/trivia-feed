-- Comprehensive diagnostic script to identify signup issues

-- 1. Check database version and configuration
SELECT version();
SELECT current_setting('server_version');

-- 2. Check table structure of user_profiles
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM 
  information_schema.columns 
WHERE 
  table_name = 'user_profiles'
ORDER BY ordinal_position;

-- 3. Check constraints on user_profiles table
SELECT
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name,
  tc.table_name
FROM 
  information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
WHERE 
  tc.table_name = 'user_profiles';

-- 4. Check if handle_new_user function exists and check its definition
SELECT EXISTS (
  SELECT 1 FROM pg_proc WHERE proname = 'handle_new_user'
) AS function_exists;

SELECT 
  proname,
  prosecdef AS is_security_definer,
  provolatile,
  pg_get_functiondef(oid) AS function_definition
FROM 
  pg_proc
WHERE 
  proname = 'handle_new_user';

-- 5. Check if the trigger exists
SELECT EXISTS (
  SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
) AS trigger_exists;

SELECT 
  tgname,
  tgenabled,
  tgtype,
  pg_get_triggerdef(oid) AS trigger_definition
FROM 
  pg_trigger
WHERE 
  tgname = 'on_auth_user_created';

-- 6. Check auth.users to see if users are being created
SELECT 
  COUNT(*) AS total_users
FROM 
  auth.users;

-- 7. Check for users without profiles
SELECT 
  COUNT(*) AS users_without_profiles
FROM 
  auth.users u
LEFT JOIN 
  public.user_profiles p ON u.id = p.id
WHERE 
  p.id IS NULL;

-- 8. Check for most recently created users
SELECT 
  u.id,
  u.email,
  u.created_at,
  u.updated_at,
  u.last_sign_in_at,
  CASE WHEN p.id IS NULL THEN 'Missing' ELSE 'Exists' END AS profile_status
FROM 
  auth.users u
LEFT JOIN 
  public.user_profiles p ON u.id = p.id
ORDER BY 
  u.created_at DESC
LIMIT 5;

-- 9. Check permissions
SELECT 
  grantee, 
  table_schema, 
  table_name, 
  privilege_type
FROM 
  information_schema.table_privileges
WHERE 
  table_name = 'user_profiles';

-- 10. Test if we can manually insert a profile (will fail with foreign key error)
DO $$
DECLARE
  test_id UUID := '00000000-0000-0000-0000-000000000000';
  error_message TEXT;
BEGIN
  BEGIN
    INSERT INTO public.user_profiles (id, username, created_at, updated_at)
    VALUES (test_id, 'test@example.com', NOW(), NOW());
  EXCEPTION 
    WHEN foreign_key_violation THEN
      RAISE NOTICE 'Foreign key violation as expected (good sign)';
    WHEN others THEN
      GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT;
      RAISE NOTICE 'Error inserting test profile: %', error_message;
  END;

  -- Now try to add a recent user that's missing a profile
  BEGIN
    -- Get most recent user without a profile
    WITH missing_profile AS (
      SELECT u.id, u.email
      FROM auth.users u
      LEFT JOIN public.user_profiles p ON u.id = p.id
      WHERE p.id IS NULL
      ORDER BY u.created_at DESC
      LIMIT 1
    )
    INSERT INTO public.user_profiles (id, username, created_at, updated_at)
    SELECT id, email, NOW(), NOW()
    FROM missing_profile
    RETURNING id, username;
    
    RAISE NOTICE 'Successfully created profile for a missing user';
  EXCEPTION
    WHEN no_data_found THEN
      RAISE NOTICE 'No users without profiles found';
    WHEN others THEN
      GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT;
      RAISE NOTICE 'Error creating profile for missing user: %', error_message;
  END;
END$$;

-- 11. Show active roles and their permissions
SELECT 
  r.rolname, 
  r.rolsuper, 
  r.rolinherit,
  r.rolcreaterole,
  r.rolcreatedb,
  r.rolcanlogin,
  r.rolreplication,
  r.rolconnlimit,
  r.rolvaliduntil
FROM 
  pg_catalog.pg_roles r
ORDER BY 
  r.rolname;

-- 12. Check for any table structure issues with user_profiles
SELECT 
  tablename, 
  attname, 
  null_frac, 
  avg_width, 
  n_distinct
FROM 
  pg_stats
WHERE 
  tablename = 'user_profiles';

-- 13. Additional checks for database health (optional)
-- Simple check for connection count by application
SELECT 
  application_name,
  COUNT(*) as connection_count
FROM 
  pg_stat_activity
GROUP BY 
  application_name
ORDER BY 
  connection_count DESC
LIMIT 10; 