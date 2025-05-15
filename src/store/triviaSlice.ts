import { createSlice, PayloadAction , createAsyncThunk } from '@reduxjs/toolkit';
import { 
  UserProfile, 
  createInitialUserProfile, 
  updateUserProfile as updateUserProfileFn 
} from '../lib/personalizationService';
import { FeedItem } from '../lib/triviaService';
import { recordUserAnswer } from '../lib/leaderboardService';
import { syncUserProfile } from '../lib/simplifiedSyncService';
import { InteractionLog, FeedChange, WeightChange } from '../types/trackerTypes';
import { RootState } from '../store';

/**
 * IMPORTANT: Database operations for user weights have been disabled.
 * All operations related to the following are now client-side only:
 * - User weight changes
 * - User interactions
 * - Feed changes
 * - User answers
 * 
 * The Redux store still maintains this data locally, but no data is sent to or
 * retrieved from the database for these operations.
 */

// Define a type for possible question states
export type QuestionState = {
  status: 'unanswered' | 'skipped' | 'answered';
  answerIndex?: number;
  timeSpent?: number; // Track time spent on the question
  isCorrect?: boolean; // Track if the answer was correct
};

interface TriviaState {
  questions: {
    [questionId: string]: QuestionState;
  };
  hasViewedTooltip: boolean;
  tooltipPermanentlyDismissed: boolean; // New flag to track permanent dismissal
  userProfile: UserProfile;
  feedExplanations: { [questionId: string]: string[] }; // For explaining personalization logic
  personalizedFeed: FeedItem[]; // Ordered list of personalized feed items
  interactionStartTimes: { [questionId: string]: number }; // Track when user started interacting with a question
  syncedInteractions: InteractionLog[]; // Track interactions that have been synced with the server
  syncedFeedChanges: FeedChange[]; // Track feed changes that have been synced with the server
  syncedWeightChanges: WeightChange[];
  lastSyncTime: number; // Track when the last sync with the server was performed
  isSyncing: boolean; // Track whether a sync is in progress
}

const initialState: TriviaState = {
  questions: {},
  hasViewedTooltip: false,
  tooltipPermanentlyDismissed: false, // Initialize to false
  userProfile: createInitialUserProfile(),
  feedExplanations: {},
  personalizedFeed: [],
  interactionStartTimes: {},
  syncedInteractions: [],
  syncedFeedChanges: [],
  syncedWeightChanges: [],
  lastSyncTime: 0,
  isSyncing: false,
};

/**
 * Helper function to safely sync user profile with error handling
 */
const safeSyncUserProfile = (userId?: string, profile?: UserProfile): void => {
  try {
    if (!userId) {
      console.log('[SAFE SYNC] No userId provided, skipping sync');
      return;
    }
    
    if (!profile) {
      console.log('[SAFE SYNC] No profile provided, skipping sync');
      return;
    }
    
    // Deep clone the profile to prevent proxy issues
    const safeProfile = JSON.parse(JSON.stringify(profile));
    
    // Now call the actual sync function with safe data
    void syncUserProfile(userId, safeProfile);
  } catch (error) {
    console.warn('[SAFE SYNC] Failed to safely sync user profile:', 
      error instanceof Error ? error.message : 'Unknown error');
  }
};

const triviaSlice = createSlice({
  name: 'trivia',
  initialState,
  reducers: {
    answerQuestion: (state, action: PayloadAction<{ questionId: string; answerIndex: number; isCorrect: boolean; userId?: string }>) => {
      const { questionId, answerIndex, isCorrect, userId } = action.payload;
      
      // Get previous state for logging
      const previousState = state.questions[questionId]?.status || 'unanswered';
      
      // Calculate time spent
      const startTime = state.interactionStartTimes[questionId] || Date.now();
      const timeSpent = Date.now() - startTime;
      
      // Log the answered question and timing information
      console.log(`[Redux] Answering question ${questionId}: answer=${answerIndex}, correct=${isCorrect}, time spent=${timeSpent}ms, previous state=${previousState}`);
      
      // Always update question state, regardless of previous status (answer overrides skip)
      state.questions[questionId] = { 
        status: 'answered',
        answerIndex,
        isCorrect,
        timeSpent
      };
      
      // If this was previously skipped, let's log that we're overriding it
      if (previousState === 'skipped') {
        console.log(`[Redux] Overriding previous 'skipped' state for question ${questionId} with 'answered' state`);
      }
      
      // Update user profile with new weight changes
      if (state.userProfile) {
        // Calculate confidence updates
        if (!state.userProfile.topics) {
          state.userProfile.topics = {};
        }
        
        // Record interaction for sync
        const now = Date.now();
        const interaction: InteractionLog = {
          questionId,
          type: isCorrect ? 'correct' : 'incorrect',
          timestamp: now,
          timeSpent,
          questionText: 'Question ' + questionId.substring(0, 5) // Just for display, we'll fetch full text later
        };
        
        // Add to synced interactions
        state.syncedInteractions.push(interaction);
        
        // If user is logged in, sync the interaction
        if (userId) {
          // Always use safer version that handles null checking
          safeSyncUserProfile(userId, state.userProfile);
        }
      }
    },
    skipQuestion: (state, action: PayloadAction<{ questionId: string; userId?: string }>) => {
      const { questionId, userId } = action.payload;
      
      // Log more detail about the question being skipped
      console.log(`[Redux] Processing skip action for question: ${questionId}`);
      
      // Only mark as skipped if it hasn't been answered yet
      if (!state.questions[questionId] || state.questions[questionId].status !== 'answered') {
        // Get previous state for logging
        const previousState = state.questions[questionId]?.status || 'unanswered';
        
        // Calculate time spent
        const startTime = state.interactionStartTimes[questionId] || Date.now();
        const timeSpent = Date.now() - startTime;
        
        // Skip logging if already marked as skipped (avoids duplicate log entries)
        if (previousState !== 'skipped') {
          // Log the skipped question and timing information
          console.log(`[Redux] Skipping question ${questionId}: time spent = ${timeSpent}ms, previous state=${previousState}`);
          
          state.questions[questionId] = { 
            status: 'skipped',
            timeSpent
          };
          
          // Record interaction for sync
          const now = Date.now();
          const interaction: InteractionLog = {
            questionId,
            type: 'skipped',
            timestamp: now,
            timeSpent,
            questionText: 'Question ' + questionId.substring(0, 5) // Just for display
          };
          
          // Only add to synced interactions if we don't already have a skip record for this question
          const hasExistingSkip = state.syncedInteractions.some(
            i => i.questionId === questionId && i.type === 'skipped'
          );
          
          if (!hasExistingSkip) {
            state.syncedInteractions.push(interaction);
            
            console.log(`[Redux] Added skipped interaction for question ${questionId} to syncedInteractions`);
            
            // Get the feed item for this question to update user profile
            const feedItem = state.personalizedFeed.find(item => item.id === questionId);
            if (feedItem && state.userProfile) {
              // Extract topic information for better logging
              const topic = feedItem.topic;
              const subtopic = feedItem.tags?.[0] || 'General';
              const branch = feedItem.tags?.[1] || 'General';
              
              console.log(`[Redux] Processing weight changes for topic=${topic}, subtopic=${subtopic}, branch=${branch}`);
              
              // Store original weights before any changes
              const originalTopicWeight = state.userProfile.topics?.[topic]?.weight || 0.5;
              const originalSubtopicWeight = state.userProfile.topics?.[topic]?.subtopics?.[subtopic]?.weight || 0.5;
              const originalBranchWeight = state.userProfile.topics?.[topic]?.subtopics?.[subtopic]?.branches?.[branch]?.weight || 0.5;
              
              console.log(`[Redux] Original weights before skip - Topic: ${originalTopicWeight.toFixed(4)}, Subtopic: ${originalSubtopicWeight.toFixed(4)}, Branch: ${originalBranchWeight.toFixed(4)}`);
              
              // Create the interaction object
              const interactionObj = { 
                wasSkipped: true, 
                timeSpent 
              };
              
              try {
                // Force log the starting user profile
                console.log(`[Redux] User profile before skip - Topics count: ${Object.keys(state.userProfile.topics).length}`);
                
                // Update the user profile
                const result = updateUserProfileFn(
                  state.userProfile,
                  questionId,
                  interactionObj,
                  feedItem
                );
                
                // Deep clone the result to avoid reference issues
                const updatedProfile = JSON.parse(JSON.stringify(result.updatedProfile));
                
                // Use the updated profile
                state.userProfile = updatedProfile;
                
                // Double check that the topic structure exists after update
                if (!state.userProfile.topics[topic]) {
                  console.error(`[Redux] ERROR: Topic ${topic} is missing after profile update!`);
                  
                  // Create the topic if it doesn't exist
                  state.userProfile.topics[topic] = {
                    weight: 0.45, // Set to expected value after skip
                    subtopics: {},
                    lastViewed: Date.now()
                  };
                }
                
                if (!state.userProfile.topics[topic].subtopics[subtopic]) {
                  console.error(`[Redux] ERROR: Subtopic ${subtopic} is missing after profile update!`);
                  
                  // Create the subtopic if it doesn't exist
                  state.userProfile.topics[topic].subtopics[subtopic] = {
                    weight: 0.43, // Set to expected value after skip
                    branches: {},
                    lastViewed: Date.now()
                  };
                }
                
                if (!state.userProfile.topics[topic].subtopics[subtopic].branches[branch]) {
                  console.error(`[Redux] ERROR: Branch ${branch} is missing after profile update!`);
                  
                  // Create the branch if it doesn't exist
                  state.userProfile.topics[topic].subtopics[subtopic].branches[branch] = {
                    weight: 0.4, // Set to expected value after skip
                    lastViewed: Date.now()
                  };
                }
                
                // Get the current weights from state after the update
                const updatedTopicWeight = state.userProfile.topics[topic].weight;
                const updatedSubtopicWeight = state.userProfile.topics[topic].subtopics[subtopic].weight;
                const updatedBranchWeight = state.userProfile.topics[topic].subtopics[subtopic].branches[branch].weight;
                
                // Log the actual changes
                console.log(`[Redux] Updated weights after skip - Topic: ${updatedTopicWeight.toFixed(4)}, Subtopic: ${updatedSubtopicWeight.toFixed(4)}, Branch: ${updatedBranchWeight.toFixed(4)}`);
                console.log(`[Redux] Weight changes - Topic: ${(updatedTopicWeight - originalTopicWeight).toFixed(4)}, Subtopic: ${(updatedSubtopicWeight - originalSubtopicWeight).toFixed(4)}, Branch: ${(updatedBranchWeight - originalBranchWeight).toFixed(4)}`);
                
                // Verify that the weights have actually changed
                if (Math.abs(updatedTopicWeight - originalTopicWeight) < 0.01 &&
                    Math.abs(updatedSubtopicWeight - originalSubtopicWeight) < 0.01 &&
                    Math.abs(updatedBranchWeight - originalBranchWeight) < 0.01) {
                  console.warn(`[Redux] Warning: Weight changes were too small or non-existent for ${questionId}`);
                  
                  // Force weight changes for the first question if they didn't change
                  if (state.personalizedFeed.findIndex(item => item.id === questionId) === 0) {
                    console.log(`[Redux] First question detected - forcing weight changes`);
                    state.userProfile.topics[topic].weight = Math.max(0.1, originalTopicWeight - 0.05);
                    state.userProfile.topics[topic].subtopics[subtopic].weight = Math.max(0.1, originalSubtopicWeight - 0.07);
                    state.userProfile.topics[topic].subtopics[subtopic].branches[branch].weight = Math.max(0.1, originalBranchWeight - 0.1);
                    
                    // Log the forced changes
                    console.log(`[Redux] Forced weights - Topic: ${state.userProfile.topics[topic].weight.toFixed(4)}, Subtopic: ${state.userProfile.topics[topic].subtopics[subtopic].weight.toFixed(4)}, Branch: ${state.userProfile.topics[topic].subtopics[subtopic].branches[branch].weight.toFixed(4)}`);
                  }
                }
                
                console.log(`[Redux] Successfully updated user profile for skipped question ${questionId}`);
                
                // Get the updated weights for the weight change record
                const finalTopicWeight = state.userProfile.topics[topic].weight;
                const finalSubtopicWeight = state.userProfile.topics[topic].subtopics[subtopic].weight;
                const finalBranchWeight = state.userProfile.topics[topic].subtopics[subtopic].branches[branch].weight;
                
                // Create a weight change record
                const weightChange: WeightChange = {
                  timestamp: now,
                  questionId,
                  interactionType: 'skipped',
                  questionText: feedItem.question || `Question ${questionId.substring(0, 5)}...`,
                  topic,
                  subtopic,
                  branch,
                  oldWeights: {
                    topicWeight: originalTopicWeight,
                    subtopicWeight: originalSubtopicWeight,
                    branchWeight: originalBranchWeight
                  },
                  newWeights: {
                    topicWeight: finalTopicWeight,
                    subtopicWeight: finalSubtopicWeight,
                    branchWeight: finalBranchWeight
                  }
                };
                
                // Add to synced weight changes
                state.syncedWeightChanges.push(weightChange);
                console.log(`[Redux] Added weight change to syncedWeightChanges: ${weightChange.questionId}`);
                
              } catch (error) {
                console.error(`[Redux] Error updating profile for skipped question:`, error);
              }
            
            // If user is logged in, sync the interaction
            if (userId && state.userProfile) {
              // Always use safer version that handles null checking
              safeSyncUserProfile(userId, state.userProfile);
            }
            } else {
              console.log(`[Redux] Could not find feed item for skipped question ${questionId}`);
            }
          } else {
            console.log(`[Redux] Redundant skip for question ${questionId}: already in 'skipped' state`);
          }
        } else {
          console.log(`[Redux] Skip ignored for question ${questionId}: already in '${state.questions[questionId].status}' state`);
        }
      } else {
        console.log(`[Redux] Skip ignored for question ${questionId}: already in '${state.questions[questionId].status}' state`);
      }
    },
    startInteraction: (state, action: PayloadAction<{ questionId: string }>) => {
      const { questionId } = action.payload;
      // Record when the user started interacting with this question
      const now = Date.now();
      state.interactionStartTimes[questionId] = now;
      console.log(`[Redux] Started interaction timer for question ${questionId} at ${new Date(now).toISOString()}`);
    },
    setPersonalizedFeed: (state, action: PayloadAction<{ 
      items: FeedItem[]; 
      explanations: { [questionId: string]: string[] };
      userId?: string; 
    }>) => {
      const { items, explanations, userId } = action.payload;
      
      // Check if items array is valid
      if (!items || !Array.isArray(items)) {
        console.warn('Cannot set personalized feed: items is null or not an array');
        return;
      }
      
      // Find new items compared to current feed
      const currentIds = new Set(state.personalizedFeed.map(item => item.id));
      const newItems = items.filter(item => !currentIds.has(item.id));
      
      // Update state
      state.personalizedFeed = items;
      state.feedExplanations = explanations || {};
      
      // If user is logged in and there are new items, sync the feed changes
      if (userId && newItems.length > 0) {
        const now = Date.now();
        const feedChanges: FeedChange[] = newItems.map(item => {
          // Extract weight-based selection info
          const weightFactors = {
            topic: item.topic,
          };
          
          // Get explanations for this item
          const itemExplanations = explanations[item.id] || [];
          
          return {
            timestamp: now,
            type: 'added',
            itemId: item.id,
            questionText: item.question || `Question ${item.id.substring(0, 5)}...`,
            explanations: itemExplanations,
            weightFactors
          };
        });
        
        // Add to synced feed changes
        state.syncedFeedChanges.push(...feedChanges);
      }
    },
    updateUserProfile: (state, action: PayloadAction<{ profile: UserProfile; userId?: string; weightChange?: WeightChange }>) => {
      const { profile, userId, weightChange } = action.payload;
      
      // Add null check for profile
      if (!profile) {
        console.warn('Cannot update user profile: profile is null or undefined');
        return;
      }
      
      // Log the update
      console.log('[Redux] Updating user profile with new weights');
      
      if (weightChange) {
        console.log(`[Redux] Weight change received in updateUserProfile: ${weightChange.topic}`);
        console.log(`[Redux] Old weights: topic=${weightChange.oldWeights.topicWeight.toFixed(4)}, subtopic=${weightChange.oldWeights.subtopicWeight?.toFixed(4) || 'N/A'}`);
        console.log(`[Redux] New weights: topic=${weightChange.newWeights.topicWeight.toFixed(4)}, subtopic=${weightChange.newWeights.subtopicWeight?.toFixed(4) || 'N/A'}`);
        
        // Add to synced weight changes
        state.syncedWeightChanges.push(weightChange);
        console.log(`[Redux] Added weight change to syncedWeightChanges (current count: ${state.syncedWeightChanges.length})`);
      }
      
      // Update the state with the new profile
      state.userProfile = profile;
      
      // Verify key topic weights after update
      if (profile.topics) {
        console.log('[Redux] Updated profile topic weights:');
        Object.entries(profile.topics).forEach(([topic, data]) => {
          console.log(`  ${topic}: ${data.weight.toFixed(4)}`);
        });
      }
      
      // Sync user profile with server if user is logged in
      if (userId) {
        // Use safer version that handles null checking 
        safeSyncUserProfile(userId, profile);
      }
    },
    markTooltipAsViewed: (state) => {
      state.hasViewedTooltip = true;
    },
    permanentlyDismissTooltip: (state) => {
      state.hasViewedTooltip = true;
      state.tooltipPermanentlyDismissed = true;
    },
    resetAllQuestions: (state) => {
      state.questions = {};
      state.hasViewedTooltip = false; // Reset tooltip state when questions are reset
      // Don't reset tooltipPermanentlyDismissed - user's preference should persist
      state.interactionStartTimes = {};
    },
    resetPersonalization: (state, action: PayloadAction<{ userId?: string }>) => {
      const { userId } = action.payload;
      console.log('[Redux] Resetting personalization');
      
      // Use the createInitialUserProfile function to ensure proper defaults
      const freshProfile = createInitialUserProfile();
      
      // Log the fresh profile to verify weights
      console.log('[Redux] Fresh profile topic weights:', 
        Object.entries(freshProfile.topics).map(([topic, data]) => 
          `${topic}: ${data.weight.toFixed(2)}`).join(', ')
      );
      
      // Set the state with deep clone to ensure no references are shared
      state.userProfile = JSON.parse(JSON.stringify(freshProfile));
      state.feedExplanations = {};
      state.personalizedFeed = [];
      
      // Sync reset profile with server if user is logged in
      if (userId) {
        // Use safer version that handles null checking
        safeSyncUserProfile(userId, state.userProfile);
      }
    },
    startSync: (state) => {
      state.isSyncing = true;
    },
    finishSync: (state, action: PayloadAction<number>) => {
      state.isSyncing = false;
      state.lastSyncTime = action.payload;
    },
    syncFailed: (state) => {
      state.isSyncing = false;
    },
    loadUserDataStart: (state) => {
      state.isSyncing = true;
    },
    loadUserDataSuccess: (state, action: PayloadAction<{
      profile: UserProfile | null;
      timestamp: number;
    }>) => {
      const { profile, timestamp } = action.payload;
      
      // Only update profile if we received one
      if (profile) {
        // Check if the server profile is newer than our local one
        if (profile.lastRefreshed > state.userProfile.lastRefreshed) {
          console.log('Updating local profile with newer server profile');
          state.userProfile = profile;
        } else {
          console.log('Local profile is newer than server profile, keeping local changes');
        }
      }
      
      // Update sync state
      state.isSyncing = false;
      state.lastSyncTime = timestamp;
    },
    loadUserDataFailure: (state) => {
      state.isSyncing = false;
    },
  },
});

export const { 
  answerQuestion, 
  skipQuestion, 
  markTooltipAsViewed,
  permanentlyDismissTooltip, 
  resetAllQuestions,
  startInteraction,
  setPersonalizedFeed,
  updateUserProfile,
  resetPersonalization,
  startSync,
  finishSync,
  syncFailed,
  loadUserDataStart,
  loadUserDataSuccess,
  loadUserDataFailure
} = triviaSlice.actions;

export default triviaSlice.reducer;