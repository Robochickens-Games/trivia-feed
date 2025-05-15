-- Check the structure of the user_profiles table and constraints

-- 1. Check the table structure
SELECT 
  column_name, 
  data_type, 
  character_maximum_length,
  is_nullable,
  column_default
FROM 
  information_schema.columns 
WHERE 
  table_name = 'user_profiles'
ORDER BY ordinal_position;

-- 2. Check constraints, especially the primary key and foreign key
SELECT
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name
FROM 
  information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
LEFT JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE 
  tc.table_name = 'user_profiles';

-- 3. Check foreign key relationship to auth.users table
SELECT EXISTS (
  SELECT 1 
  FROM information_schema.table_constraints 
  WHERE table_name = 'user_profiles' 
  AND constraint_type = 'FOREIGN KEY'
) AS foreign_key_exists;

-- 4. Check triggers associated with user_profiles
SELECT 
  trigger_name,
  event_manipulation,
  action_statement
FROM 
  information_schema.triggers
WHERE 
  event_object_table = 'user_profiles';

-- 5. Check if handle_new_user function exists and is correctly defined
SELECT 
  proname AS function_name,
  prosecdef AS security_definer,
  pg_get_functiondef(oid) AS function_definition
FROM 
  pg_proc
WHERE 
  proname = 'handle_new_user';

-- 6. Check on_auth_user_created trigger
SELECT 
  tgname AS trigger_name,
  pg_get_triggerdef(oid) AS trigger_definition
FROM 
  pg_trigger
WHERE 
  tgname = 'on_auth_user_created'; 