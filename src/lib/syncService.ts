import { supabase } from './supabaseClient';
import { UserProfile } from './personalizationService';
import { FeedChange, InteractionLog, WeightFactors, WeightChange } from '../types/trackerTypes';
import { Platform } from 'react-native';
import { EventEmitter } from 'events';
import { syncUserProfile as simplifiedSyncUserProfile, fetchUserProfile as simplifiedFetchUserProfile } from './simplifiedSyncService';

// Create a global event emitter for logging database operations
export const dbEventEmitter = new EventEmitter();

// Helper function to log database operations
export const logDbOperation = (
  direction: 'sent' | 'received',
  table: string,
  operation: 'insert' | 'update' | 'select' | 'upsert' | 'delete',
  records: number,
  data: any,
  userId?: string,
  status: 'success' | 'error' = 'success',
  error?: string
) => {
  // Only log in development mode
  if (!__DEV__) return;
  
  try {
    // Safe copy of data to prevent proxy handler errors
    let safeData: any;
    try {
      // Handle potential circular references or proxy objects
      safeData = JSON.parse(JSON.stringify(data || {}));
    } catch (jsonError) {
      // If JSON serialization fails, create a simplified representation
      safeData = { 
        note: "Original data couldn't be safely serialized",
        type: typeof data,
        isNull: data === null,
        isUndefined: data === undefined
      };
    }
    
    const logData = {
      timestamp: Date.now(),
      direction,
      table,
      operation,
      records,
      data: safeData,
      userId: userId || 'unknown',
      status,
      error: error || null
    };
    
    // Emit the db operation event
    dbEventEmitter.emit('db-operation', logData);
    
    // Also log to console
    console.log(`[DB ${direction.toUpperCase()}] ${operation.toUpperCase()} ${records} records to ${table}`, 
      status === 'error' ? `ERROR: ${error}` : 'Success');
  } catch (loggingError) {
    // Fallback if even our error handling fails
    console.log(`Failed to log DB operation: ${loggingError instanceof Error ? loggingError.message : 'Unknown error'}`);
  }
};

// Get a unique device identifier for tracking sync sources
const getDeviceId = () => {
  const platform = Platform.OS;
  const deviceId = `${platform}-${Date.now()}`;
  return deviceId;
};

/**
 * Syncs the user profile data with Supabase
 */
export async function syncUserProfile(userId: string, userProfile: UserProfile): Promise<void> {
  // Forward to the simplified sync service with a note
  console.log('Using simplified sync service for user profile');
  return simplifiedSyncUserProfile(userId, userProfile);
}

/**
 * Handles merging local and server profiles in case of conflict
 */
async function handleProfileMerge(userId: string, localProfile: UserProfile): Promise<void> {
  try {
    // Check if localProfile is valid
    if (!userId || !localProfile) {
      console.log('Invalid arguments for profile merge:', {
        hasUserId: !!userId,
        hasLocalProfile: !!localProfile
      });
      return;
    }

    let serverProfile = null;
    let error = null;
    
    // Fetch the latest server profile
    try {
      const result = await supabase
        .from('user_profile_data')
        .select('*')
        .eq('id', userId)
        .single();
      
      serverProfile = result.data;
      error = result.error;
    } catch (fetchError) {
      console.error('Supabase request failed during profile merge:', fetchError);
      return;
    }
    
    // Safely create query object for logging
    const safeQueryObject = { id: userId };
    
    // Log the select operation with safe objects
    logDbOperation(
      'sent', 
      'user_profile_data', 
      'select', 
      1, 
      { query: safeQueryObject, columns: ['*'] },
      userId,
      error ? 'error' : 'success',
      error?.message
    );
    
    if (error) {
      console.error('Error fetching server profile for merge:', error);
      return;
    }
    
    // Verify serverProfile exists
    if (!serverProfile) {
      console.log('Server profile not found, cannot perform merge');
      return;
    }
    
    // Log the received data safely
    logDbOperation(
      'received', 
      'user_profile_data', 
      'select', 
      1, 
      serverProfile,
      userId
    );
    
    // Ensure timestamp values are properly initialized
    const localLastRefreshed = localProfile.lastRefreshed || 0;
    const serverLastRefreshed = serverProfile.last_refreshed || 0;
    
    // TODO: Implement more sophisticated merge logic
    // For now, we'll keep the profile with the most recent lastRefreshed timestamp
    if (localLastRefreshed > serverLastRefreshed) {
      // Local profile is newer, try update again
      const updateData = {
        topics: localProfile.topics || {},
        cold_start_complete: localProfile.coldStartComplete || false,
        total_questions_answered: localProfile.totalQuestionsAnswered || 0,
        last_refreshed: localLastRefreshed,
        version: (serverProfile.version || 0) + 1
      };
      
      try {
        const { error: updateError } = await supabase
          .from('user_profile_data')
          .update(updateData)
          .eq('id', userId)
          .eq('version', serverProfile.version || 0);
        
        // Create safe query object for logging
        const safeUpdateQuery = {
          id: userId,
          version: serverProfile.version || 0
        };
        
        // Log the update operation with safe objects
        logDbOperation(
          'sent', 
          'user_profile_data', 
          'update', 
          1, 
          { query: safeUpdateQuery, data: updateData },
          userId,
          updateError ? 'error' : 'success',
          updateError?.message
        );
        
        if (updateError) {
          console.error('Error during profile merge update:', updateError);
        }
      } catch (updateError) {
        console.error('Failed to execute profile merge update:', updateError);
      }
    }
  } catch (error) {
    // Handle error safely to prevent Proxy handler is null errors
    try {
      // Structured error logging with safety checks
      const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      const errorStack = error instanceof Error ? error.stack : '';
      
      console.error('Error in handleProfileMerge:', {
        name: errorName,
        message: errorMsg,
        userId: userId || 'undefined',
        hasLocalProfile: localProfile ? 'yes' : 'no',
        stackPreview: errorStack ? errorStack.split('\n').slice(0, 3).join('\n') : 'No stack trace'
      });
    } catch (nestedError) {
      // Ultimate fallback
      console.log('CRITICAL ERROR: Failed to handle error in profile merge.');
    }
  }
}

/**
 * Retrieves the user profile from Supabase
 */
export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  try {
    if (!userId) {
      console.log('No user ID provided for fetch');
      return null;
    }

    console.log('Fetching user profile data for user:', userId);
    
    const { data, error } = await supabase
      .from('user_profile_data')
      .select('*')
      .eq('id', userId)
      .single();
    
    // Log the select operation
    logDbOperation(
      'sent', 
      'user_profile_data', 
      'select', 
      1, 
      { query: { id: userId }, columns: ['*'] },
      userId,
      error ? 'error' : 'success',
      error?.message
    );
    
    if (error) {
      console.error('Error fetching user profile:', error);
      return null;
    }
    
    if (!data) {
      console.log('No profile found for user');
      return null;
    }
    
    // Log the received data
    logDbOperation(
      'received', 
      'user_profile_data', 
      'select', 
      1, 
      data,
      userId
    );
    
    return {
      topics: data.topics || {},
      interactions: {}, // Initialize with empty object
      lastRefreshed: data.last_refreshed,
      coldStartComplete: data.cold_start_complete || false,
      totalQuestionsAnswered: data.total_questions_answered || 0
    };
  } catch (error) {
    console.error('Error in fetchUserProfile:', error);
    return null;
  }
}

/**
 * Syncs user interactions with Supabase
 */
export async function syncUserInteractions(userId: string, interactions: InteractionLog[]): Promise<void> {
  // Do not actually sync to the deprecated table
  console.log('DEPRECATED: syncUserInteractions called - ignored');
  return;
}

/**
 * Retrieves user interactions from Supabase
 */
export async function fetchUserInteractions(
  userId: string,
  afterTimestamp?: number
): Promise<InteractionLog[]> {
  // Do not actually fetch from the deprecated table
  console.log('DEPRECATED: fetchUserInteractions called - returning empty array');
  return [];
}

/**
 * Syncs feed changes with Supabase
 * With aggressive optimization to minimize database growth
 */
export async function syncFeedChanges(userId: string, feedChanges: FeedChange[]): Promise<void> {
  // Do not actually sync to the deprecated table
  console.log('DEPRECATED: syncFeedChanges called - ignored');
  return;
}

/**
 * Retrieves feed changes from Supabase
 */
export async function fetchFeedChanges(
  userId: string,
  afterTimestamp?: number
): Promise<FeedChange[]> {
  // Do not actually fetch from the deprecated table
  console.log('DEPRECATED: fetchFeedChanges called - returning empty array');
  return [];
}

/**
 * Syncs user weight changes with Supabase
 */
export async function syncWeightChanges(userId: string, weightChanges: WeightChange[]): Promise<void> {
  // Do not actually sync to the deprecated table
  console.log('DEPRECATED: syncWeightChanges called - ignored');
  return;
}

/**
 * Retrieves weight changes from Supabase
 */
export async function fetchWeightChanges(
  userId: string,
  afterTimestamp?: number
): Promise<WeightChange[]> {
  // Do not actually fetch from the deprecated table
  console.log('DEPRECATED: fetchWeightChanges called - returning empty array');
  return [];
}

/**
 * Comprehensive function to load all user data during app startup
 * This ensures consistency across sessions and platforms
 */
export async function loadUserData(userId: string): Promise<{
  profile: UserProfile | null;
  interactions: InteractionLog[];
  feedChanges: FeedChange[];
  weightChanges: WeightChange[];
}> {
  console.log('Redirecting to simplified service for loading user data');
  
  try {
    // Forward to simplified service to get the profile
    const profile = await simplifiedFetchUserProfile(userId);
    
    // Return with empty arrays for the deprecated data
    return {
      profile,
      interactions: [],
      feedChanges: [],
      weightChanges: []
    };
  } catch (error) {
    console.error('Error loading user data:', error);
    
    // Return empty data as fallback
    return {
      profile: null,
      interactions: [],
      feedChanges: [],
      weightChanges: []
    };
  }
}

/**
 * Aggressively cleans up feed changes to prevent database bloat
 * This function runs during app startup and periodically
 */
export async function cleanupFeedChanges(userId: string): Promise<void> {
  try {
    if (!userId) {
      return;
    }
    
    console.log('Aggressively cleaning up feed changes');
    
    // 1. Delete old records (3 days instead of 7)
    const oldTimestamp = Date.now() - (3 * 24 * 60 * 60 * 1000);
    
    const { error: deleteError } = await supabase
      .from('user_feed_changes')
      .delete()
      .eq('user_id', userId)
      .lt('timestamp', oldTimestamp);
    
    // 2. Fix any records with future timestamps
    const { error: fixTimestampError } = await supabase
      .rpc('fix_future_timestamps', { user_id_param: userId });
    
    // 3. Enforce maximum records per user (100)
    const { error: limitError } = await supabase
      .rpc('limit_feed_changes_per_user', { 
        user_id_param: userId,
        max_records: 100
      });
    
    // Log the operations
    logDbOperation(
      'sent', 
      'user_feed_changes', 
      'delete', 
      1, 
      { 
        operations: [
          { type: 'delete_old', timestamp_threshold: oldTimestamp },
          { type: 'fix_timestamps' },
          { type: 'limit_records', max_per_user: 100 }
        ]
      },
      userId,
      deleteError || fixTimestampError || limitError ? 'error' : 'success',
      deleteError?.message || fixTimestampError?.message || limitError?.message
    );
    
    if (deleteError || fixTimestampError || limitError) {
      console.error('Error during feed changes cleanup:', 
        deleteError || fixTimestampError || limitError);
    } else {
      console.log('Successfully cleaned up feed changes');
    }
  } catch (error) {
    console.error('Error in cleanupFeedChanges:', error);
  }
}

// Helper function to log question generation events
export const logGeneratorEvent = (
  userId: string,
  primaryTopics: string[],
  adjacentTopics: string[],
  questionsGenerated: number,
  questionsSaved: number,
  success: boolean,
  error?: string,
  status?: string
) => {
  // Check if we're in dev mode in a cross-platform way
  const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : 
               (process.env.NODE_ENV === 'development');
  
  // Skip extensive logging in production
  // But always log critical errors
  if (!isDev && !error) return;
  
  try {
    const logData = {
      timestamp: Date.now(),
      userId,
      primaryTopics,
      adjacentTopics,
      questionsGenerated,
      questionsSaved,
      success,
      error,
      status
    };
    
    // Emit the generator event for UI tracking 
    dbEventEmitter.emit('generatorEvent', logData);
    
    // Only log start, completion, or errors to console
    if (error) {
      console.error(`[GENERATOR] ERROR: ${error}`);
    } else if (status?.includes('completed')) {
      console.log(`[GENERATOR] COMPLETED: Generated ${questionsGenerated}, saved ${questionsSaved} questions`);
    }
  } catch (loggingError) {
    // Only log critical errors
    console.error(`[GENERATOR] Failed to log event: ${loggingError instanceof Error ? loggingError.message : 'Unknown error'}`);
  }
}; 