-- Migration script: Convert existing user tracking data to the simplified schema

-- 1. First create a backup of all tables
CREATE TABLE IF NOT EXISTS public.user_profile_data_backup AS 
SELECT * FROM public.user_profile_data;

CREATE TABLE IF NOT EXISTS public.user_interactions_backup AS 
SELECT * FROM public.user_interactions;

CREATE TABLE IF NOT EXISTS public.user_feed_changes_backup AS 
SELECT * FROM public.user_feed_changes;

-- 2. Create the new schema (skipped if you've already run simplified_user_profile_schema.sql)
-- See simplified_user_profile_schema.sql

-- 3. Create a temporary table with the new structure
CREATE TABLE IF NOT EXISTS public.user_profile_data_new (
  id UUID PRIMARY KEY,
  topics JSONB NOT NULL DEFAULT '{}'::jsonb,
  interactions JSONB NOT NULL DEFAULT '{}'::jsonb,
  cold_start_complete BOOLEAN DEFAULT FALSE,
  total_questions_answered INTEGER DEFAULT 0,
  last_refreshed BIGINT NOT NULL,
  last_synced TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INTEGER DEFAULT 1
);

-- 4. Migrate data from old tables to new format
DO $$
DECLARE
    user_id UUID;
    interaction_data JSONB;
    user_interactions JSONB;
BEGIN
    -- Process each user
    FOR user_id IN SELECT DISTINCT id FROM public.user_profile_data
    LOOP
        RAISE NOTICE 'Processing user %', user_id;
        
        -- Start with empty interactions object
        user_interactions := '{}'::jsonb;
        
        -- Aggregate user's interactions into a JSONB object
        SELECT 
            jsonb_object_agg(
                question_id,
                jsonb_build_object(
                    'timeSpent', time_spent,
                    'wasCorrect', CASE WHEN interaction_type = 'correct' THEN true
                                      WHEN interaction_type = 'incorrect' THEN false
                                      ELSE null END,
                    'wasSkipped', interaction_type = 'skipped',
                    'viewedAt', timestamp
                )
            ) INTO interaction_data
        FROM public.user_interactions
        WHERE user_id = user_id;
        
        -- Use interaction data if found, otherwise empty object
        IF interaction_data IS NOT NULL THEN
            user_interactions := interaction_data;
        END IF;
        
        -- Insert data into the new table format
        INSERT INTO public.user_profile_data_new (
            id,
            topics,
            interactions,
            cold_start_complete,
            total_questions_answered,
            last_refreshed,
            last_synced,
            version
        )
        SELECT 
            id,
            topics,
            user_interactions,
            cold_start_complete,
            total_questions_answered,
            last_refreshed,
            last_synced,
            version
        FROM public.user_profile_data
        WHERE id = user_id;
        
        RAISE NOTICE 'Migrated profile and % interactions for user %', 
            jsonb_object_keys(user_interactions), user_id;
    END LOOP;
END $$;

-- 5. Verify the migration before replacing tables
SELECT 
    'Old user_profile_data count: ' || COUNT(*)::text as old_profile_count 
FROM public.user_profile_data
UNION ALL
SELECT 
    'New user_profile_data_new count: ' || COUNT(*)::text as new_profile_count 
FROM public.user_profile_data_new;

-- 6. Replace the old table with the new one
-- WARNING: Only run this after verifying the data migration was successful
/*
DROP TABLE IF EXISTS public.user_profile_data CASCADE;
ALTER TABLE public.user_profile_data_new RENAME TO user_profile_data;

-- 7. Add back constraints and indexes
ALTER TABLE public.user_profile_data 
    ADD CONSTRAINT user_profile_data_id_fkey 
    FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.user_profile_data 
    ADD CONSTRAINT user_profile_data_id_key UNIQUE (id);

CREATE INDEX IF NOT EXISTS idx_user_profile_data_last_refreshed 
    ON public.user_profile_data(last_refreshed);

-- 8. Enable RLS and create policies (these might need to be recreated)
ALTER TABLE public.user_profile_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile data" ON public.user_profile_data
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile data" ON public.user_profile_data
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile data" ON public.user_profile_data
  FOR INSERT WITH CHECK (auth.uid() = id);

-- 9. Drop old tables (optional - only after successful migration and testing)
-- DROP TABLE IF EXISTS public.user_interactions CASCADE;
-- DROP TABLE IF EXISTS public.user_feed_changes CASCADE;
*/

-- Execute the following to see how many interactions were migrated for each user:
SELECT 
    id, 
    jsonb_object_keys(interactions) as interaction_count
FROM public.user_profile_data_new; 