-- Create user_profiles table in Supabase to store additional user information
-- This extends the default auth.users table that Supabase automatically creates

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Set up Row Level Security (RLS) for the table
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Create policies for Row Level Security
-- Allow users to view any profile
CREATE POLICY "Allow users to view any profile" ON public.user_profiles
  FOR SELECT USING (true);

-- Allow users to update only their own profile
CREATE POLICY "Allow users to update their own profile" ON public.user_profiles
  FOR UPDATE USING (auth.uid() = id);

-- Allow new users to insert their profile
CREATE POLICY "Allow users to insert their own profile" ON public.user_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Function to automatically create a profile when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, full_name, country, avatar_url)
  VALUES (
    NEW.id,
    UPPER(SUBSTRING(NEW.email, 1, 2)),  -- Extract first two letters from email and uppercase
    'OT',  -- Set default country to "Other"
    NEW.raw_user_meta_data->>'avatar_url' -- Extract from metadata if available
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to call the function when a new user is created
CREATE OR REPLACE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user(); 