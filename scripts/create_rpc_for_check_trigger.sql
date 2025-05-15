-- Create a function to check if a trigger exists
CREATE OR REPLACE FUNCTION public.check_trigger_exists(trigger_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM pg_trigger 
    WHERE tgname = trigger_name
  );
END;
$$;

-- Grant execution permission
GRANT EXECUTE ON FUNCTION public.check_trigger_exists(TEXT) TO service_role;
COMMENT ON FUNCTION public.check_trigger_exists(TEXT) IS 'Checks if a database trigger exists by name';

-- Create a function to check if the user profile handler function exists
CREATE OR REPLACE FUNCTION public.check_function_exists(function_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM pg_proc 
    WHERE proname = function_name
  );
END;
$$;

-- Grant execution permission
GRANT EXECUTE ON FUNCTION public.check_function_exists(TEXT) TO service_role;
COMMENT ON FUNCTION public.check_function_exists(TEXT) IS 'Checks if a database function exists by name'; 