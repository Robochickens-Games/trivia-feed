# Trivia Feed System Architecture and Data Flow

This document provides a comprehensive overview of the Trivia Feed system architecture, including the technical stack, data flow between components, and specific examples of how user interactions affect the system.

## Table of Contents

1. [System Overview](#system-overview)
2. [Technical Stack](#technical-stack)
3. [Architecture Layers](#architecture-layers)
4. [Database Schema](#database-schema)
5. [User Profile and Personalization](#user-profile-and-personalization)
6. [Cold Start Algorithm](#cold-start-algorithm)
7. [Question Scoring Algorithm](#question-scoring-algorithm)
8. [Data Flow Examples](#data-flow-examples)
9. [Synchronization Mechanism](#synchronization-mechanism)
10. [Error Handling](#error-handling)
11. [Design System and Theming](#design-system-and-theming)
12. [OpenAI Integration](#openai-integration)
13. [Performance Considerations](#performance-considerations)

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
- **AI**: OpenAI API via Supabase Edge Functions

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
   - OpenAI integration in `/src/lib/openaiService.ts`

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
  coldStartState?: any; // For tracking cold start algorithm state
  lastQuestionAnswered?: {
    questionId: string;
    answer?: string;
    correct?: boolean;
    skipped?: boolean;
    topic: string;
  }; // Track last question for cold start algorithm
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

- **Incorrect answers** also increase weights (but less than correct answers):
  - Topic: +0.05
  - Subtopic: +0.07
  - Branch: +0.1

- **Skipped questions** decrease weights:
  - Topic: -0.05
  - Subtopic: -0.07
  - Branch: -0.1

- **Compensation** for previously skipped questions that are later answered correctly:
  - Topic: +0.05
  - Subtopic: +0.07
  - Branch: +0.1

- **Compensation** for previously skipped questions that are later answered incorrectly:
  - Topic: +0.03
  - Subtopic: +0.04
  - Branch: +0.05

## Cold Start Algorithm

The system employs a sophisticated cold start algorithm to build an initial user profile. This occurs during the first 20 questions the user interacts with, divided into three distinct phases:

### Phase 1: Initial Exploration (Questions 1-5)
- **Goal**: Sample diverse topics to identify initial interests
- **Selection Logic**: Presents questions from a curated set of exploration topics
- **Weight Updates**: Initial weights are set at 0.5; correct answers increase weights by 0.1
- **Question Filtering**: Only easy and medium difficulty questions are shown

### Phase 2: Branching Phase (Questions 6-12)
- **Goal**: Build on identified interests while maintaining some exploration
- **Selection Logic**:
  - 70% questions from topics with weights > 0.5 (preferred)
  - 30% from unexplored or lower-weight topics (exploration)
- **Weight Updates**: Continues adjusting weights based on interactions
- **Topic Diversity**: Limits consecutive questions from the same topic (max 2)
- **Diversity Factor**: Topics that appear frequently are penalized to ensure variety

### Phase 3: Adaptive Personalization (Questions 13-20)
- **Goal**: Refine user preferences with more targeted content
- **Selection Logic**:
  - 80% questions from high-weight topics
  - 20% exploration questions
- **Subtopic Expansion**: Introduces new subtopics within preferred topics
- **Filtering**: Excludes topics with weights < 0.3

### Phase 4: Steady State (Questions 21+)
- **Goal**: Provide highly personalized content with strategic exploration
- **Selection Logic**:
  - Advanced scoring algorithm based on topic affinity, novelty, and other factors
  - Excludes topics with weights < 0.2
  - Introduces new topics occasionally based on exploration percentages

### Checkpoint Logic
The system adds fresh questions to the feed at specific checkpoints (positions 4, 8, 12, 16, 20) to ensure the feed remains populated. These checkpoints enforce the appropriate selection logic for the current phase.

```javascript
// Code that handles cold start phases in feed generation
if (isColdStart) {
  // Phase 1 (Questions 1-5): Pure exploration
  if (totalQuestionsAnswered < 5) {
    return !existingIds.has(item.id) && isAppropriateDifficulty;
  }
  
  // Phase 2 (Questions 6-12): Begin using initial topic weights
  if (totalQuestionsAnswered < 12) {
    const isLowWeight = userProfile.topics[item.topic]?.weight < 0.2;
    return !existingIds.has(item.id) && !isLowWeight && isAppropriateDifficulty;
  }
  
  // Phase 3 (Questions 13-20): Adaptive Personalization
  if (totalQuestionsAnswered < 20) {
    const isLowWeight = userProfile.topics[item.topic]?.weight < 0.3;
    return !existingIds.has(item.id) && !isLowWeight;
  }
} else {
  // Phase 4 (Beyond 20 questions): Steady state
  const isLowWeight = userProfile.topics[item.topic]?.weight < 0.2;
  return !existingIds.has(item.id) && !isLowWeight;
}
```

## Question Scoring Algorithm

After the cold start phase, questions are scored using a weighted algorithm combining multiple factors:

### Scoring Factors and Weights

```javascript
// Weight factors for scoring algorithm
const WEIGHTS = {
  accuracy: 0.25,      // 25% - Previous performance on this question
  timeSpent: 0.15,     // 15% - How long user took to answer
  skipPenalty: -0.2,   // 20% - Penalty for previously skipped questions
  topicAffinity: 0.3,  // 30% - How well the question matches user's topic preferences
  novelty: 0.15,       // 15% - Bonus for never-seen questions
  cooldown: 0.1,       // 10% - Time-based cooldown after viewing
  
  // Time thresholds
  fastAnswerThreshold: 3000,     // 3 seconds
  longAnswerThreshold: 15000,    // 15 seconds
};
```

### Score Calculation Process

1. **Topic Affinity** (30% of score)
   - Average of topic, subtopic, and branch weights
   - Higher weights result in higher scores

2. **Previous Interaction** (if exists)
   - **Accuracy** (25%): Bonus for previously correct, penalty for incorrect
   - **Time Spent** (15%): Bonus for fast answers, penalty for very slow answers
   - **Skip Penalty** (-20%): Negative score for previously skipped questions
   - **Cooldown Bonus** (up to 10%): Increases over time since last viewing

3. **Novelty Bonus** (15%)
   - Applied to questions user has never seen before

### Example Scoring Calculation

```javascript
function calculateQuestionScore(question, userProfile) {
  let score = 0;
  const explanations = [];
  
  // Topic affinity component (30%)
  const topicWeight = userProfile.topics[question.topic]?.weight || 0.5;
  const subtopicWeight = userProfile.topics[question.topic]?.subtopics[subtopic]?.weight || 0.5;
  const branchWeight = userProfile.topics[question.topic]?.subtopics[subtopic]?.branches[branch]?.weight || 0.5;
  
  const topicAffinity = (topicWeight + subtopicWeight + branchWeight) / 3;
  score += topicAffinity * 0.3;
  
  // Previous interaction components
  const interaction = userProfile.interactions[question.id];
  if (interaction) {
    // Accuracy component (25%)
    if (interaction.wasCorrect !== undefined) {
      score += interaction.wasCorrect ? 0.25 : -0.25;
    }
    
    // Time spent component (15%)
    if (interaction.timeSpent < 3000) {
      score += 0.15; // Fast answer bonus
    } else if (interaction.timeSpent > 15000) {
      score -= 0.15; // Slow answer penalty
    }
    
    // Skip penalty (-20%)
    if (interaction.wasSkipped) {
      score -= 0.2;
    }
    
    // Cooldown bonus (up to 10%)
    const daysSinceLastView = (Date.now() - interaction.viewedAt) / (1000 * 60 * 60 * 24);
    const cooldownBonus = Math.min(daysSinceLastView * 0.1, 0.5);
    score += cooldownBonus;
  } else {
    // Novelty bonus (15%)
    score += 0.15;
  }
  
  return { score, explanations };
}
```

### Exploration Percentages

To ensure users discover new content, the system reserves portions of the feed for exploration:

```javascript
const EXPLORATION = {
  newRootTopics: 0.05,  // 5% for entirely new topics
  newSubtopics: 0.10,   // 10% for new subtopics within known topics
  newBranches: 0.15,    // 15% for new branches within known subtopics
};
```

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

### Example 4: Checkpoint Expansion During Cold Start

When the user reaches a checkpoint (position 4, 8, 12, 16, 20) during cold start:

1. **Checkpoint Detection**:
   ```javascript
   // In FeedScreen.tsx
   if (viewableItems[0].index === 4 || viewableItems[0].index === 8 || 
       viewableItems[0].index === 12 || viewableItems[0].index === 16 || 
       viewableItems[0].index === 20) {
     addQuestionsAtCheckpoint(viewableItems[0].index, userProfile);
   }
   ```

2. **Topic Selection**:
   ```javascript
   // Select available questions based on the checkpoint phase
   const availableQuestions = feedData.filter(item => {
     const totalQuestionsAnswered = userProfile.totalQuestionsAnswered || 0;
     const isColdStart = !userProfile.coldStartComplete;
     
     if (isColdStart) {
       if (totalQuestionsAnswered < 5) {
         // Phase 1: Pure exploration
         return !existingIds.has(item.id) && isAppropriateDifficulty;
       } else if (totalQuestionsAnswered < 12) {
         // Phase 2: Begin using weights
         const isLowWeight = userProfile.topics[item.topic]?.weight < 0.2;
         return !existingIds.has(item.id) && !isLowWeight && isAppropriateDifficulty;
       } else {
         // Phase 3: Adaptive personalization
         const isLowWeight = userProfile.topics[item.topic]?.weight < 0.3;
         return !existingIds.has(item.id) && !isLowWeight;
       }
     }
   });
   ```

3. **Feed Update**:
   ```javascript
   // Add new questions to feed with explanations
   dispatch(setPersonalizedFeed({
     items: [...currentFeed, ...newQuestions],
     explanations: combinedExplanations,
     userId: user?.id || undefined
   }));
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

5. **Write-Only Sync Optimization**
   The sync system uses a simplified write-only approach for better performance:
   
   ```javascript
   // In simplifiedSyncService.ts
   async function _syncUserProfile(userId: string, userProfile: UserProfile): Promise<void> {
     // Simple data structure - same for all operations
     const profileData = {
       id: userId,
       topics: userProfile.topics || {},
       interactions: userProfile.interactions || {}, 
       cold_start_complete: userProfile.coldStartComplete || false,
       total_questions_answered: userProfile.totalQuestionsAnswered || 0,
       last_refreshed: userProfile.lastRefreshed
     };
     
     // Simple upsert - works consistently for all operations
     const { error: upsertError } = await supabase
       .from('user_profile_data')
       .upsert(profileData, { 
         onConflict: 'id'
       });
     
     // IMPORTANT: No fetching after update - pure write operation
   }
   ```

## Error Handling

The system implements robust error handling strategies to ensure a smooth user experience even when things go wrong:

1. **Supabase Client Fallback**:
   ```javascript
   // Create a dummy client that logs errors but falls back gracefully
   supabase = new Proxy({}, {
     get: function(obj, prop) {
       if (prop === 'from') {
         return (tableName: string) => {
           console.warn(`Attempting to access table '${tableName}' with non-functional client`);
           
           // Return an object that mimics Supabase query builder
           return {
             select: () => Promise.resolve({ data: null, error: { message: 'Client not initialized' } }),
             insert: () => Promise.resolve({ data: null, error: { message: 'Client not initialized' } }),
             // Other methods...
           };
         };
       }
     }
   });
   ```

2. **Sync Error Recovery**:
   - Operations that fail are retried on next sync interval
   - Temporary network issues are transparently handled

3. **Validation Checks**:
   ```javascript
   // Check if profile is valid
   if (!userId || !userProfile) {
     console.log('Invalid arguments for profile sync');
     return;
   }
   
   // Ensure lastRefreshed is set
   if (!userProfile.lastRefreshed) {
     userProfile.lastRefreshed = Date.now();
   }
   ```

4. **Weight Consistency Checks**:
   ```javascript
   // Check for suspiciously non-default weights in a new user profile
   if (Object.keys(updatedProfile.interactions).length <= 1) {
     if (Math.abs(oldWeights.topicWeight - DEFAULT_TOPIC_WEIGHT) > 0.01) {
       console.warn(`Warning: Topic weight is not default for a new user profile. Resetting to default.`);
       topicNode.weight = DEFAULT_TOPIC_WEIGHT;
     }
   }
   ```

5. **Safe Error Logging**:
   ```javascript
   try {
     // Structured error logging with safety checks
     const errorMsg = error instanceof Error ? error.message : 'Unknown error';
     const errorName = error instanceof Error ? error.name : 'UnknownError';
     
     console.error('Error in operation:', {
       name: errorName,
       message: errorMsg,
       userId: userId || 'undefined',
       stackPreview: error?.stack ? error.stack.slice(0, 3).join('\n') : 'No stack'
     });
   } catch (nestedError) {
     // Ultimate fallback
     console.log('CRITICAL ERROR: Failed to handle error.');
   }
   ```

## Design System and Theming

The application uses a comprehensive design system that supports multiple themes and ensures visual consistency across platforms.

### Design Tokens

The design system is built around a set of foundational tokens defined in `src/design/index.ts`:

```typescript
// Core design tokens exported for application-wide use
const designSystem = {
  colors,
  typography,
  spacing,
  layout,
  borderRadius,
  borderWidth,
  shadows,
  transitions,
  breakpoints,
  zIndex,
  categoryColors,
};
```

### Theme Architecture

The app supports multiple themes, each implementing a common `ThemeDefinition` interface:

```typescript
// Theme definition interface
interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  colors: {
    light: Record<string, string>;
    dark: Record<string, string>;
  };
  typography: TypographyDefinition;
  spacing: SpacingDefinition;
  borderRadius: BorderRadiusDefinition;
  shadows: ShadowDefinition;
  animations: AnimationDefinition;
}

// Available themes
const themes = {
  default: defaultTheme,
  neon: neonTheme,
  retro: retroTheme,
  modern: modernTheme
};
```

### Supported Themes

The app includes four distinct themes:

1. **Default Theme**: Clean, modern design with a yellow/blue color scheme
2. **Neon Theme**: High-contrast theme with vibrant colors and glow effects
3. **Retro Theme**: Nostalgic design with 80s/90s-inspired colors and fonts
4. **Modern Theme**: Material Design-inspired theme with modern aesthetics

### Typography System

The typography system is platform-aware and ensures consistent text rendering:

```typescript
// Base font families based on platform
const baseFontFamily = {
  base: Platform.select({
    ios: 'System',
    android: 'Inter-Regular',
    default: 'Inter-Regular',
    web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  }) || 'System',
  bold: Platform.select({
    ios: 'System-Bold',
    android: 'Inter-Bold',
    default: 'Inter-Bold',
    web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  }) || 'System-Bold',
  serif: Platform.select({
    ios: 'Georgia',
    android: 'serif',
    default: 'serif',
    web: 'Georgia, serif',
  }) || 'Georgia',
  monospace: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'monospace',
    web: 'Menlo, monospace',
  }) || 'Menlo',
};

// Base shared typography
const baseTypography: TypographyDefinition = {
  fontFamily: baseFontFamily,
  fontSize: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
    '4xl': 36,
  },
  fontWeight: {
    light: '300',
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
  lineHeight: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
    loose: 2,
  },
};
```

### Spacing System

A consistent spacing scale is used throughout the application:

```typescript
const baseSpacing: SpacingDefinition = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
};
```

### Shadow System

Platform-specific shadow definitions ensure consistent elevation across platforms:

```typescript
const baseShadows: ShadowDefinition = {
  none: {},
  sm: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.18,
      shadowRadius: 1.0,
    },
    android: {
      elevation: 1,
    },
    default: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.18,
      shadowRadius: 1.0,
    },
  }) || {},
  // Additional shadow levels...
};
```

### Animation System

The animation system defines consistent durations and easing functions:

```typescript
const baseAnimations: AnimationDefinition = {
  duration: {
    faster: 100,
    fast: 200,
    normal: 300,
    slow: 500,
  },
  easing: {
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    linear: 'linear',
  },
};
```

### Topic Color System

Each topic has a dedicated color for visual identification:

```typescript
export const topicColors: Record<string, string> = {
  'Science': '#3498db',
  'History': '#8e44ad',
  'Geography': '#27ae60',
  'Sports': '#e67e22',
  'Music': '#9b59b6',
  'Art': '#e74c3c',
  'Pop Culture': '#f39c12',
  // More topic colors...
};
```

### Neon Theme Effects

The Neon theme includes special visual effects for an immersive experience:

1. **Glow Effects**: UI elements have cyan/magenta glow effects

   ```typescript
   // Enhanced shadows for neon theme
   shadows: {
     sm: Platform.select({
       ios: {
         shadowColor: '#00FFFF',
         shadowOffset: { width: 0, height: 0 },
         shadowOpacity: 0.5,
         shadowRadius: 4,
       },
       // ...
     }),
     // Additional shadow levels...
   }
   ```

2. **Pulsing Animations**: Components pulse with varying intensity

   ```javascript
   // Add CSS keyframes animation for web platform
   useEffect(() => {
     if (Platform.OS === 'web' && isNeonTheme) {
       const styleEl = document.createElement('style');
       styleEl.innerHTML = `
         @keyframes neonPulse {
           0% {
             box-shadow: 0 0 4px currentColor, 0 0 8px rgba(255, 255, 255, 0.2);
           }
           100% {
             box-shadow: 0 0 8px currentColor, 0 0 12px rgba(255, 255, 255, 0.2);
           }
         }
       `;
       document.head.appendChild(styleEl);
       return () => document.head.removeChild(styleEl);
     }
   }, [isNeonTheme]);
   ```

3. **Dynamic Background Gradients**: Background elements have animated gradients

   ```javascript
   // Create style for animated background
   const styleEl = document.createElement('style');
   styleEl.innerHTML = `
     @keyframes bgGlow {
       0% { 
         background-position: 0% 0%;
         opacity: 0.8;
       }
       50% { 
         background-position: 100% 100%;
         opacity: 1;
       }
       100% { 
         background-position: 0% 0%;
         opacity: 0.8;
       }
     }
     
     .neon-bg-enhancer {
       background: radial-gradient(circle at center, transparent 0%, 
                   transparent 40%, ${glowColor + '10'} 70%, 
                   ${glowColor + '25'} 100%);
       background-size: 200% 200%;
       animation: bgGlow 15s ease infinite;
     }
   `;
   ```

### Theme Access Hook

Components access theme properties through the `useDesignSystem` hook:

```typescript
export function useDesignSystem() {
  const { colorScheme, themeDefinition } = useTheme();
  const isDark = colorScheme === 'dark';
  
  // Get the colors for the current color scheme
  const themeColors = isDark ? themeDefinition.colors.dark : themeDefinition.colors.light;

  return {
    colors: themeColors,
    typography: themeDefinition.typography,
    spacing: themeDefinition.spacing,
    borderRadius: themeDefinition.borderRadius,
    shadows: themeDefinition.shadows,
    animations: themeDefinition.animations,
    isDark,
    colorScheme,
  };
}
```

### Component Style Creation

The system provides helpers to create component styles with proper theming:

```typescript
export function createTextStyle(
  theme: ReturnType<typeof useDesignSystem>,
  colorKey: keyof ReturnType<typeof useDesignSystem>['colors'],
  typographyVariant?: keyof ReturnType<typeof useDesignSystem>['typography']['fontSize']
): TextStyle {
  const baseStyle: TextStyle = {
    color: theme.colors[colorKey],
  };
  
  if (typographyVariant) {
    return {
      ...baseStyle,
      fontSize: theme.typography.fontSize[typographyVariant],
      fontFamily: theme.typography.fontFamily.base,
      lineHeight: theme.typography.fontSize[typographyVariant] * theme.typography.lineHeight.normal,
    };
  }
  
  return baseStyle;
}
```

## OpenAI Integration

The application integrates with OpenAI's API to dynamically generate personalized trivia questions based on user interactions and preferences.

### Architecture Overview

1. **Client-Side Components**:
   - `src/lib/openaiService.ts`: Main service for OpenAI API communication
   - `src/lib/questionGeneratorService.ts`: Orchestrates question generation logic
   - `src/hooks/useQuestionGenerator.ts`: React hook for component integration

2. **Server-Side Components**:
   - Supabase Edge Function `generateTriviaQuestions`: Securely proxies requests to OpenAI
   - Database tables for storing and retrieving generated questions

### API Key Management

OpenAI API keys are secured through multiple layers:

```javascript
// In openaiService.ts
// Access environment variables based on the platform
try {
  // For Expo/React Native, use Constants
  if (Constants.expoConfig?.extra?.openaiApiKey) {
    OPENAI_API_KEY = Constants.expoConfig.extra.openaiApiKey;
  }
  // For web, access React environment variables (from .env.local)
  else if (typeof process !== 'undefined' && process.env && process.env.REACT_APP_OPENAI_KEY) {
    OPENAI_API_KEY = process.env.REACT_APP_OPENAI_KEY;
  }
} catch (error) {
  console.error('[GENERATOR] Error loading OpenAI API key:', error);
}
```

For production, the API key is never exposed to clients. Instead, the app uses Supabase Edge Functions to securely make API calls server-side.

### Question Generation Algorithm Logic

The system uses a sophisticated algorithm to select topics and create personalized prompts for generating trivia questions. This process involves several key steps:

#### 1. Topic Selection and Prioritization

The system selects topics using a weighted scoring approach:

```javascript
// In questionGeneratorService.ts
// Step 2.1: Get the most recent answered questions
const recentTopics = await getRecentAnsweredTopics(userId, 10);

// Step 2.2: Extract weighted topics from user profile
const weightedTopics: {name: string, weight: number}[] = [];
if (userProfile && userProfile.topics) {
  weightedTopics.push(
    ...Object.entries(userProfile.topics)
      .map(([name, data]) => ({ name, weight: data.weight || 0 }))
      .sort((a, b) => b.weight - a.weight)
  );
}

// Step 2.3: Create a balanced prioritized topic list by combining recency and weight
const topicScores: Record<string, number> = {};

// Score recent topics (0.5 points for each, with most recent getting more)
recentTopics.forEach((topic, index) => {
  const recencyScore = 0.5 * (recentTopics.length - index) / recentTopics.length;
  topicScores[topic] = (topicScores[topic] || 0) + recencyScore;
});

// Score weighted topics (direct weight value from profile)
weightedTopics.forEach(topic => {
  topicScores[topic.name] = (topicScores[topic.name] || 0) + topic.weight;
});

// Calculate final scores and sort
const scoredTopics = Object.entries(topicScores)
  .map(([topic, score]) => ({ topic, score }))
  .sort((a, b) => b.score - a.score);

// Take top topics as prioritized list
const prioritizedTopics = scoredTopics.slice(0, 6).map(t => t.topic);
```

This approach ensures that questions are generated for topics the user has both:
- Recently interacted with (recency score)
- Demonstrated high interest in (weight score from profile)

#### 2. Hierarchical Topic Combinations

The system builds specialized topic-subtopic and topic-branch combinations for more targeted question generation:

```javascript
// Step 2.4: Extract subtopics from high-weight main topics
const subtopicWeights: {topic: string, subtopic: string, weight: number}[] = [];

if (userProfile && userProfile.topics) {
  // Extract subtopics from top weighted topics with weight >= 0.5
  Object.entries(userProfile.topics)
    .filter(([topicName]) => {
      const foundTopic = weightedTopics.find(t => t.name === topicName);
      return foundTopic && foundTopic.weight >= 0.5;
    })
    .forEach(([topicName, topicData]) => {
      Object.entries(topicData.subtopics || {}).forEach(([subtopicName, subtopicData]) => {
        subtopicWeights.push({
          topic: topicName,
          subtopic: subtopicName,
          weight: subtopicData.weight || 0
        });
      });
    });
}

// Create combined hierarchical topics (topic:subtopic, topic:branch)
const combinedTopics: string[] = [];

// Add topic:subtopic combinations for topics with high weights
if (subtopicWeights.length > 0) {
  const sortedSubtopicWeights = [...subtopicWeights].sort((a, b) => b.weight - a.weight);
  
  // Take top 3 subtopics and create combined format
  sortedSubtopicWeights.slice(0, 3).forEach(item => {
    combinedTopics.push(`${item.topic}:${item.subtopic}`);
  });
}
```

This hierarchical approach allows the system to request questions about very specific areas of interest (e.g., "History:Renaissance" instead of just "History").

#### 3. Adjacent Topic Discovery

To expand user interests, the system identifies related topics:

```javascript
// Step 3: Get adjacent topics for exploration
const topicMapper = getTopicMapper();
const adjacentTopics: string[] = [];

primaryTopics.forEach(topic => {
  const related = topicMapper.getRelatedTopics(topic);
  adjacentTopics.push(...related);
});

// Deduplicate and remove any that are already in primary topics
const uniqueAdjacentTopics = Array.from(new Set(adjacentTopics))
  .filter(topic => !primaryTopics.includes(topic));
```

The `TopicMapper` uses a predefined relationship map:

```javascript
// In topicMapperService.ts
const TOPIC_RELATIONS: Record<string, string[]> = {
  'Science': ['Physics', 'Biology', 'Chemistry', 'Astronomy', 'Technology'],
  'Physics': ['Science', 'Astronomy', 'Mathematics'],
  'History': ['Ancient History', 'Modern History', 'Politics', 'Geography'],
  // More mappings...
};
```

#### 4. Subtopic and Branch Extraction

To further enhance personalization, the system extracts top subtopics and branches:

```javascript
// Extract top subtopics, branches, and tags for more detailed prompting
if (userProfile && userProfile.topics) {
  // Collect all subtopics with weights
  const allSubtopics: {topic: string, subtopic: string, weight: number}[] = [];
  const allBranches: {topic: string, subtopic: string, branch: string, weight: number}[] = [];
  
  // Extract subtopics and branches
  Object.entries(userProfile.topics).forEach(([topicName, topicData]) => {
    Object.entries(topicData.subtopics || {}).forEach(([subtopicName, subtopicData]) => {
      // Add subtopic with full context
      allSubtopics.push({
        topic: topicName,
        subtopic: subtopicName,
        weight: subtopicData.weight || 0
      });
      
      // Add branches with full context
      Object.entries(subtopicData.branches || {}).forEach(([branchName, branchData]) => {
        allBranches.push({
          topic: topicName,
          subtopic: subtopicName,
          branch: branchName,
          weight: branchData.weight || 0
        });
      });
    });
  });
  
  // Sort by weight and take top items
  topSubtopics.push(...allSubtopics.sort((a, b) => b.weight - a.weight).slice(0, 5));
  topBranches.push(...allBranches.sort((a, b) => b.weight - a.weight).slice(0, 5));
}
```

#### 5. Tags and Recent Questions

The system also extracts popular tags from recent questions:

```javascript
// Get tags from most recent questions the user has answered
const { data: answerData } = await supabase
  .from('user_answers')
  .select('question_id')
  .eq('user_id', userId)
  .order('answer_time', { ascending: false })
  .limit(10);

if (answerData && answerData.length > 0) {
  const questionIds = answerData.map((item: { question_id: string }) => item.question_id);
  
  // Get tags from these questions
  const { data: questionData } = await supabase
    .from('trivia_questions')
    .select('tags')
    .in('id', questionIds);
  
  // Extract and flatten all tags
  const allTags: string[] = [];
  questionData?.forEach((item: { tags: string[] }) => {
    if (item.tags && Array.isArray(item.tags)) {
      allTags.push(...item.tags);
    }
  });
  
  // Count tag frequency and take the most common
  const tagCounts = allTags.reduce((acc: Record<string, number>, tag) => {
    acc[tag] = (acc[tag] || 0) + 1;
    return acc;
  }, {});
  
  // Sort by frequency and take top 8
  topTags.push(
    ...Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag]) => tag)
  );
}
```

Additionally, recent questions are identified to avoid generating duplicates:

```javascript
// Get recent questions to avoid duplication 
if (recentQuestions && recentQuestions.length > 0) {
  // Use client-provided recent questions
  validRecentQuestions = recentQuestions
    .filter(q => q.questionText && q.questionText.length > 10)
    .slice(0, 15); // Limit to 15 questions
}
```

#### 6. Final Question Generation and Storage

The system brings together all this personalization data to generate unique questions:

```javascript
// Generate questions with detailed preferences
const generatedQuestions = await generateQuestions(
  primaryTopics,               // Main topics of interest
  uniqueAdjacentTopics,        // Related topics for exploration
  6,                           // 6 questions from primary topics
  6,                           // 6 questions from adjacent topics
  finalSubtopics,              // Preferred subtopics
  finalBranches,               // Preferred branches
  finalTags,                   // Preferred tags
  validRecentQuestions         // Recent questions to avoid duplication
);

// Filter out duplicates and save to database
const savedCount = await saveUniqueQuestions(generatedQuestions);
```

### Question Generation Process

1. **Trigger Conditions**

   The question generation is triggered based on user activity:

   ```javascript
   // In useQuestionGenerator.ts
   const triggerQuestionGeneration = useCallback(async (userId: string) => {
     // Rate limiting - prevent multiple calls within 5 seconds
     const now = Date.now();
     const timeSinceLastAttempt = now - lastGenerationAttemptRef.current;
     
     if (timeSinceLastAttempt < 5000) {
       return false;
     }
     
     // Initialize counter for this user if it doesn't exist
     if (!answeredQuestionsRef.current[userId]) {
       answeredQuestionsRef.current[userId] = 0;
     }
     
     // Increment the counter for this user
     answeredQuestionsRef.current[userId]++;
     const currentCount = answeredQuestionsRef.current[userId];
     
     // Only generate questions every 6 questions
     if (currentCount % 6 !== 0) {
       return false;
     }
     
     // Generate questions...
   ```

2. **Topic Selection Logic**

   The system intelligently selects topics based on user interaction history:

   ```javascript
   // Extract client-side interaction data for topic generation
   const clientRecentTopics: string[] = [];
   const clientRecentSubtopics: string[] = [];
   const clientRecentBranches: string[] = [];
   const clientRecentTags: string[] = [];
   
   // Enhanced hierarchical structures
   const topicSubtopicCombos: string[] = [];
   const topicBranchCombos: string[] = [];
   
   // Track interaction weights to prioritize frequently encountered items
   const topicWeights: Record<string, number> = {};
   
   // Create a mixed array of primary topics for question generation
   const enhancedTopics: string[] = [];
   
   // Add top regular topics (up to 3)
   enhancedTopics.push(...clientRecentTopics.slice(0, 3));
   
   // Add top topic+subtopic combinations (up to 2)
   if (topicSubtopicCombos.length > 0) {
     enhancedTopics.push(...topicSubtopicCombos.slice(0, 2));
   }
   ```

3. **Prompt Construction**

   A detailed prompt is dynamically constructed with personalization elements:

   ```javascript
   const prompt = `Generate 12 unique trivia questions for a trivia app, with detailed personalization:

   DISTRIBUTION AND STRUCTURE:
   - 6 questions about primary user interest topics: ${orderedPrimaryTopics.join(', ')}
     NOTE: The topics are listed in ORDER OF PRIORITY. Strongly favor the FIRST 3 topics in this list.
     
   - 6 questions about adjacent topics for exploration: ${shuffledAdjacentTopics.join(', ')}
     These are for variety and exploring related interests.

   CRITICAL DUPLICATION RULES:
   - Within this single response, do NOT create multiple questions about the same:
     * Person/artist/historical figure (e.g., don't ask two different questions about Michael Jackson)
     * Work/album/book/movie (e.g., don't ask about both sales and content of "Thriller")
     * Event/phenomenon (e.g., don't ask two questions about the same historical event)
     * Concept (e.g., don't ask multiple questions testing the same knowledge point)
   
   ${hierarchySection}
   ${subtopicsSection}
   ${branchesSection}
   ${recentQuestionsSection}
   
   For EACH question, include:
   1. A main topic (e.g., "Science", "History", "Geography") - choose from the provided topics
   2. A specific subtopic that represents a specialized area of the main topic
   3. A precise branch that represents a very specific sub-area within the subtopic
   4. 3-5 specific, descriptive tags related to the question content
   5. Four answer choices with only one correct
   6. Difficulty level (easy, medium, hard)
   7. A "learning capsule" providing interesting additional context about the answer
   8. The tone ("educational", "fun", "challenging", "neutral")
   9. Format ("multiple_choice")`;
   ```

4. **Edge Function Invocation**

   The client securely calls the Supabase Edge Function:

   ```javascript
   const { data, error } = await supabase.functions.invoke('generateTriviaQuestions', {
     body: {
       model: 'gpt-4o-mini',
       messages: [
         {
           role: 'system',
           content: 'You are a specialized trivia question generator that creates high-quality, factually accurate questions with detailed categorization for a trivia app. You must ONLY respond with a valid JSON array without any additional text, formatting, or explanations.'
         },
         {
           role: 'user',
           content: prompt
         }
       ],
       temperature: 0.8,
       max_tokens: 4000
     }
   });
   ```

5. **Processing and Storage**

   Generated questions go through deduplication and are stored in the database:

   ```javascript
   // In questionGeneratorService.ts
   async function saveUniqueQuestions(questions: GeneratedQuestion[]): Promise<number> {
     let savedCount = 0;
     
     // Process each question
     for (const question of questions) {
       // Create a fingerprint for deduplication
       const fingerprint = createQuestionFingerprint(question.question);
       
       // Format the data for database storage
       const { data: existingQuestion } = await supabase
         .from('trivia_questions')
         .select('id')
         .eq('fingerprint', fingerprint)
         .limit(1);
       
       // Skip duplicates
       if (existingQuestion && existingQuestion.length > 0) {
         continue;
       }
       
       // Insert the question
       const { error } = await supabase
         .from('trivia_questions')
         .insert({
           id: 'gen_' + Math.random().toString(36).substring(2, 10),
           question_text: question.question,
           answer_choices: question.answers.map(a => a.text),
           correct_answer: question.answers.find(a => a.isCorrect)?.text,
           difficulty: question.difficulty || 'medium',
           topic: question.category,
           subtopic: question.subtopic || '',
           branch: question.branch || '',
           tags: question.tags || [],
           learning_capsule: question.learningCapsule || '',
           source: 'generated',
           created_at: new Date().toISOString(),
           fingerprint: fingerprint
         });
     }
     
     return savedCount;
   }
   ```

### Example Data Flow: Question Generation

When a user has answered 6 questions, the following data flow occurs:

1. **React Component**: User answers a question and the hook detects the trigger condition
   ```javascript
   // In FeedScreen.tsx
   const { triggerQuestionGeneration, trackQuestionInteraction } = useQuestionGenerator();
   
   useEffect(() => {
     if (user?.id && questionAnswered) {
       trackQuestionInteraction(
         user.id, 
         currentQuestion.id, 
         currentQuestion.topic, 
         currentQuestion.subtopic, 
         currentQuestion.branch,
         currentQuestion.tags,
         currentQuestion.question_text
       );
       
       // Try to generate new questions after user interaction
       triggerQuestionGeneration(user.id);
     }
   }, [questionAnswered, currentQuestion.id]);
   ```

2. **Question Generator Hook**: Analyzes user interaction patterns
   ```javascript
   // Create a mixed array of topics based on user history
   // This data is used to personalize the generated questions
   const enhancedTopics = [];
   enhancedTopics.push(...clientRecentTopics.slice(0, 3));
   if (topicSubtopicCombos.length > 0) {
     enhancedTopics.push(...topicSubtopicCombos.slice(0, 2));
   }
   ```

3. **OpenAI Service**: Builds a personalized prompt based on user preferences
   ```javascript
   const prompt = `Generate 12 unique trivia questions for a trivia app with detailed personalization...`;
   ```

4. **Supabase Edge Function**: Makes a secure call to OpenAI API
   ```javascript
   const { data, error } = await supabase.functions.invoke('generateTriviaQuestions', { /* params */ });
   ```

5. **OpenAI Response Processing**: Parses and validates the generated questions
   ```javascript
   const content = parsedData?.choices?.[0]?.message?.content;
   const questions = JSON.parse(content) as GeneratedQuestion[];
   ```

6. **Database Storage**: Stores unique questions with metadata
   ```javascript
   const { error } = await supabase
     .from('trivia_questions')
     .insert({
       // Question data...
       source: 'generated',
       created_at: new Date().toISOString()
     });
   ```

7. **Feed Integration**: New questions are incorporated into the personalized feed
   ```javascript
   // In triviaService.ts
   // Questions with source='generated' are included in query results
   const { data, error } = await supabase
     .from('trivia_questions')
     .select('*')
     .limit(limit);
   ```

### Security and Error Handling

The OpenAI integration includes robust error handling:

```javascript
// In openaiService.ts
try {
  // API calls...
} catch (parseError) {
  console.error('[GENERATOR] Error parsing response data:', parseError);
  console.error('[GENERATOR] Raw data:', data);
  throw new Error('Failed to parse response from Edge Function');
}
```

To prevent API key exposure, all OpenAI calls are proxied through Supabase Edge Functions, ensuring API keys never appear in client-side code.

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

6. **Topic Diversity Mechanisms**:
   - Prevents repetitive content from the same topic
   - Maximum of 2 consecutive questions from the same topic
   - Topics used recently receive a diversity penalty in scoring 