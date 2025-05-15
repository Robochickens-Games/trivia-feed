# Trivia Feed System Architecture and Data Flow

This document provides a comprehensive overview of the Trivia Feed system architecture, including the technical stack, data flow between components, and specific examples of how user interactions affect the system.

## Table of Contents

1. [System Overview](#system-overview)
2. [Technical Stack](#technical-stack)
3. [Architecture Layers](#architecture-layers)
4. [Database Schema](#database-schema)
5. [User Profile and Personalization](#user-profile-and-personalization)
6. [Data Flow Examples](#data-flow-examples)
7. [Synchronization Mechanism](#synchronization-mechanism)
8. [Performance Considerations](#performance-considerations)

## System Overview

Trivia Feed is a mobile application that offers a TikTok-style vertical swipe interface for trivia questions. The system uses a personalization algorithm that adapts to user preferences and knowledge levels through a sophisticated weighting system.

The application follows a **local-first** architecture approach where operations happen on the device first for immediate feedback, then sync to the server asynchronously. This ensures a responsive user experience even with intermittent connectivity.

## Technical Stack

### Frontend
- **Framework**: React Native with Expo
- **Navigation**: Expo Router
- **State Management**: Redux Toolkit with Redux Persist
- **UI Components**: Custom components and React Native Paper
- **Animations**: React Native Reanimated
- **Styling**: Themed components with support for light/dark modes

### Backend
- **Service**: Supabase (PostgreSQL-based Backend-as-a-Service)
- **Authentication**: Supabase Auth (email/password, Google, Apple)
- **Database**: PostgreSQL via Supabase
- **Storage**: Supabase Storage for media assets

## Architecture Layers

The application is structured into several distinct layers:

1. **Presentation Layer** (UI Components)
   - Screen components in `/src/features/`
   - Reusable UI components in `/src/components/`

2. **State Management Layer**
   - Redux store configuration in `/src/store/index.ts`
   - Trivia slice in `/src/store/triviaSlice.ts`
   - Persistence configuration with Redux Persist

3. **Service Layer**
   - Personalization logic in `/src/lib/personalizationService.ts`
   - Auth services in `/src/context/AuthContext.tsx`
   - Trivia service in `/src/lib/triviaService.ts`

4. **API Layer**
   - Supabase client in `/src/lib/supabaseClient.ts`
   - Sync service in `/src/lib/simplifiedSyncService.ts`

5. **Storage Layer**
   - AsyncStorage for local persistence
   - Supabase for remote storage

## Database Schema

### User Profiles Table
```sql
CREATE TABLE public.user_profile_data (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  topics JSONB NOT NULL DEFAULT '{}'::jsonb,      -- Topic weights hierarchy
  interactions JSONB NOT NULL DEFAULT '{}'::jsonb, -- Interaction history
  cold_start_complete BOOLEAN DEFAULT FALSE,
  total_questions_answered INTEGER DEFAULT 0,
  last_refreshed BIGINT NOT NULL, -- timestamp in milliseconds
  last_synced TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INTEGER DEFAULT 1       -- For optimistic concurrency control
);
```

### Trivia Questions Table
```sql
CREATE TABLE public.trivia_questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question TEXT NOT NULL,
  correct_answer TEXT NOT NULL,
  incorrect_answers TEXT[] NOT NULL,
  explanation TEXT,
  difficulty TEXT DEFAULT 'medium',
  category TEXT NOT NULL,
  tags TEXT[],
  source TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  fingerprint TEXT  -- For deduplication
);
```

## User Profile and Personalization

The user profile structure uses a hierarchical weighting system:

```typescript
type UserProfile = {
  topics: { [topicName: string]: RootTopic };
  interactions: { [questionId: string]: QuestionInteraction };
  lastRefreshed: number;
  coldStartComplete?: boolean;
  totalQuestionsAnswered?: number;
};

type RootTopic = {
  weight: number;  // 0.1 to 1.0
  subtopics: { [subtopicName: string]: SubTopic };
  lastViewed?: number;
};

type SubTopic = {
  weight: number;  // 0.1 to 1.0
  branches: { [branchName: string]: TopicBranch };
  lastViewed?: number;
};

type TopicBranch = {
  weight: number;  // 0.1 to 1.0
  lastViewed?: number;
};
```

Weight adjustments occur based on user interactions:

- **Correct answers** increase weights:
  - Topic: +0.1
  - Subtopic: +0.15
  - Branch: +0.2

- **Skipped questions** decrease weights:
  - Topic: -0.05
  - Subtopic: -0.07
  - Branch: -0.1

- **Compensation** for previously skipped questions that are later answered correctly:
  - Topic: +0.05
  - Subtopic: +0.07
  - Branch: +0.1

## Data Flow Examples

### Example 1: User Answers a Question Correctly

When a user answers a question correctly, the following data flow occurs:

1. **User Action**: User selects the correct answer on a Science/Physics question
2. **Local State Update**:
   ```javascript
   // In triviaSlice.ts - Redux action
   dispatch(answerQuestion({
     questionId: 'question123',
     answerIndex: 2,
     isCorrect: true,
     timeSpent: 5000
   }))
   ```

3. **Weight Calculation**:
   ```javascript
   // In personalizationService.ts
   // Increase weights for correct answer
   topicNode.weight = Math.min(1.0, topicNode.weight + 0.1);
   subtopicNode.weight = Math.min(1.0, subtopicNode.weight + 0.15);
   branchNode.weight = Math.min(1.0, branchNode.weight + 0.2);
   ```

4. **Redux State Update**:
   ```javascript
   // Update occurs in trivia slice reducer
   state.userProfile.topics['Science'].weight += 0.1;
   state.userProfile.topics['Science'].subtopics['Physics'].weight += 0.15;
   state.userProfile.topics['Science'].subtopics['Physics'].branches['General'].weight += 0.2;
   ```

5. **Staged for Sync**:
   - The interaction is recorded locally
   - Sync counter is incremented

6. **Background Sync** (happens every 5 minutes or on app close):
   ```javascript
   // In simplifiedSyncService.ts
   const { data, error } = await supabase
     .from('user_profile_data')
     .upsert({
       id: userId,
       topics: JSON.stringify(userProfile.topics),
       interactions: JSON.stringify(userProfile.interactions),
       total_questions_answered: userProfile.totalQuestionsAnswered || 0,
       last_refreshed: userProfile.lastRefreshed,
       version: currentVersion + 1
     }, { onConflict: 'id' })
     .select();
   ```

7. **Response Handling**:
   - If successful, the sync state is updated
   - If failed, it will retry on next sync interval

### Example 2: User Skips a Question

When a user skips a question:

1. **User Action**: User swipes to skip a History question
2. **Local State Update**:
   ```javascript
   // In triviaSlice.ts
   dispatch(skipQuestion({
     questionId: 'question456'
   }))
   ```

3. **Weight Adjustment**:
   ```javascript
   // In personalizationService.ts
   // Reduce weights for skipped question
   topicNode.weight = Math.max(0.1, topicNode.weight - 0.05);
   subtopicNode.weight = Math.max(0.1, subtopicNode.weight - 0.07);
   branchNode.weight = Math.max(0.1, branchNode.weight - 0.1);
   ```

4. **Redux State Update**:
   ```javascript
   // Update occurs in trivia slice reducer
   state.userProfile.topics['History'].weight -= 0.05;
   state.userProfile.topics['History'].subtopics['Ancient'].weight -= 0.07;
   state.userProfile.topics['History'].subtopics['Ancient'].branches['Rome'].weight -= 0.1;
   ```

5. **Background Sync** happens as described in Example 1

### Example 3: Initial App Load / User Login

When a user opens the app or logs in:

1. **Check Local Store**: App checks if there's a persisted state
2. **Auth Check**:
   ```javascript
   // In AuthContext.tsx
   const { data, error } = await supabase.auth.getSession();
   if (data.session) {
     // User is logged in
     setUser(data.session.user);
   }
   ```

3. **Profile Sync**:
   ```javascript
   // In simplifiedSyncService.ts
   const { data, error } = await supabase
     .from('user_profile_data')
     .select('*')
     .eq('id', userId)
     .single();
   
   if (data) {
     // Remote profile exists
     // Compare last_refreshed timestamps to determine which is newer
     if (data.last_refreshed > localProfile.lastRefreshed) {
       // Remote profile is newer, use it
       return {
         topics: data.topics,
         interactions: data.interactions || {},
         lastRefreshed: data.last_refreshed,
         coldStartComplete: data.cold_start_complete || false,
         totalQuestionsAnswered: data.total_questions_answered || 0
       };
     }
   }
   ```

4. **Question Fetching**:
   ```javascript
   // In triviaService.ts
   const { data, error } = await supabase
     .from('trivia_questions')
     .select('*')
     .limit(50);
   
   // Transform data for feed
   return data.map(item => ({
     id: item.id,
     question: item.question,
     correctAnswer: item.correct_answer,
     incorrectAnswers: item.incorrect_answers,
     explanation: item.explanation,
     difficulty: item.difficulty,
     topic: item.category,
     tags: item.tags
   }));
   ```

5. **Feed Personalization**:
   ```javascript
   // In personalizationService.ts
   const feedItems = getPersonalizedFeed(questions, userProfile);
   
   // Update Redux store
   dispatch(setPersonalizedFeed(feedItems));
   ```

## Synchronization Mechanism

The app uses a simplified sync approach with a single table for user data:

1. **Local-First Operations**:
   - All user interactions happen locally first
   - Redux state is updated immediately
   - AsyncStorage persists the state between app launches

2. **Sync Triggers**:
   - Every 5 minutes while the app is open
   - When the user logs out
   - When the app closes
   - After a certain number of interactions (configurable)

3. **Optimistic Concurrency Control**:
   - Version field in the database prevents conflicting updates
   - If conflict occurs, the app applies a merge strategy:
     - For topic weights, it takes the higher value
     - For interactions, it combines both sets

4. **Conflict Resolution Example**:
   ```javascript
   // In simplifiedSyncService.ts
   if (error && error.code === 'P2002') { // Prisma unique constraint error
     // Version conflict, fetch latest
     const { data: latestData } = await supabase
       .from('user_profile_data')
       .select('*')
       .eq('id', userId)
       .single();
     
     // Merge strategies
     const mergedTopics = mergeTopics(userProfile.topics, latestData.topics);
     const mergedInteractions = {...latestData.interactions, ...userProfile.interactions};
     
     // Try update again with new version
     const { data: updatedData, error: updateError } = await supabase
       .from('user_profile_data')
       .upsert({
         id: userId,
         topics: mergedTopics,
         interactions: mergedInteractions,
         total_questions_answered: Math.max(userProfile.totalQuestionsAnswered || 0, latestData.total_questions_answered),
         last_refreshed: Date.now(),
         version: latestData.version + 1
       });
   }
   ```

## Performance Considerations

1. **Offline Support**:
   - The app functions fully offline
   - Changes are synced when connectivity is restored

2. **Bundle Size Optimization**:
   - Lazy loading of non-critical assets
   - Proper code splitting

3. **Rendering Performance**:
   - Virtualized lists for feed items
   - Memoization for expensive calculations
   - Debounced weight updates for rapid interactions

4. **Battery Optimization**:
   - Sync operations batched to minimize network calls
   - Background sync uses low-priority networking

5. **Storage Efficiency**:
   - Interaction history pruning for older entries
   - Shared objects for common data structures 