# Simplified User Data Synchronization

This document outlines the simplified approach to storing and synchronizing user data in the Trivia Feed app.

## Overview

The simplified sync system uses a single database table to store all user-related data, including:
- Topic weights hierarchy (as JSON)
- User interaction history (as JSON)
- Profile metadata (cold start status, question count, etc.)

This approach significantly reduces database complexity while maintaining all the functionality of the previous system.

## Database Schema

The simplified schema uses a single table:

```sql
CREATE TABLE public.user_profile_data (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  topics JSONB NOT NULL DEFAULT '{}'::jsonb,      -- Topic weights hierarchy
  interactions JSONB NOT NULL DEFAULT '{}'::jsonb, -- Interaction history
  cold_start_complete BOOLEAN DEFAULT FALSE,
  total_questions_answered INTEGER DEFAULT 0,
  last_refreshed BIGINT NOT NULL, -- timestamp in milliseconds
  last_synced TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INTEGER DEFAULT 1,  -- For optimistic concurrency control
);
```

## Data Structure

### Topics JSON

The `topics` column stores the entire topic weights hierarchy:

```json
{
  "Science": {
    "weight": 0.75,
    "subtopics": {
      "Physics": {
        "weight": 0.6,
        "branches": {
          "Quantum": {
            "weight": 0.8,
            "lastViewed": 1625432800000
          }
        },
        "lastViewed": 1625432800000
      }
    },
    "lastViewed": 1625432800000
  }
}
```

### Interactions JSON

The `interactions` column stores the user's interaction history:

```json
{
  "question123": {
    "timeSpent": 5000,
    "wasCorrect": true,
    "wasSkipped": false,
    "viewedAt": 1625432800000
  },
  "question456": {
    "timeSpent": 8000,
    "wasCorrect": false,
    "wasSkipped": false,
    "viewedAt": 1625432810000
  }
}
```

## Sync Implementation

The system uses a "local-first" approach where operations happen locally for performance, then sync to the server asynchronously.

### When Syncing Occurs

1. **Initial Load**
   - When a user logs in, their complete profile is fetched from the database
   - If a remote profile exists and is newer, it updates the local profile
   - If the local profile is newer, it's synced to the server

2. **Periodic Sync**
   - Every 5 minutes while the app is open
   - Syncs the entire user profile with all interactions

3. **Final Sync**
   - When the user logs out or closes the app
   - Ensures the final state is saved to the database

### Optimistic Concurrency Control

The `version` field in the database is used to handle concurrent updates:
1. When fetching a profile, the current version is also retrieved
2. When updating, the version is incremented
3. The update will only succeed if the version hasn't changed since fetching
4. If there's a version conflict, a merge strategy is applied

## Implementation Files

The simplified sync system consists of the following files:

1. **Database Schema**
   - `sql/simplified_user_profile_schema.sql` - SQL schema for the simplified table

2. **Migration Script**
   - `sql/migrate_to_simplified_schema.sql` - Script to migrate data from the old schema

3. **Sync Service**
   - `src/lib/simplifiedSyncService.ts` - Core sync functionality

4. **Redux Integration**
   - `src/store/simplifiedTriviaSlice.ts` - Simplified Redux state management

5. **Sync Manager**
   - `src/components/SimplifiedSyncManager.tsx` - Component that manages the sync process

## Benefits Over Previous Approach

1. **Reduced Database Complexity**
   - Single table instead of three separate tables
   - No need for separate syncing of interactions, feed changes, etc.

2. **Improved Performance**
   - Fewer database queries for syncing
   - Reduced overhead from multiple small operations

3. **Simpler Code**
   - Streamlined sync logic
   - Easier to maintain and debug

4. **Efficient Storage**
   - JSON storage reduces the need for many individual records
   - Interactions are stored together with their context

## Migration Process

To migrate from the old multi-table approach to the simplified approach:

1. Run the simplified schema creation script:
   ```
   sql/simplified_user_profile_schema.sql
   ```

2. Run the migration script to convert data:
   ```
   sql/migrate_to_simplified_schema.sql
   ```

3. Update app imports to use the simplified components:
   - Use `SimplifiedSyncManager` instead of `SyncManager`
   - Import from `simplifiedTriviaSlice` instead of `triviaSlice`
   - Import from `simplifiedSyncService` instead of `syncService`

## Conclusion

This simplified approach maintains all the functionality of the previous system while reducing complexity and improving performance. The single-table design with JSON storage provides a more efficient way to sync user data across devices while maintaining the local-first approach for optimal user experience. 