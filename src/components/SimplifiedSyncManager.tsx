import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { 
  syncFailed,
  loadUserDataStart,
  loadUserDataSuccess,
  forceSyncProfile
} from '../store/simplifiedTriviaSlice'; // Updated import path
import { 
  syncUserProfile,
  loadUserData,
  markInitialDataLoadComplete,
  logSyncStatus,
  hasAllDefaultWeights,
  fetchProfileWithDefaultCheck,
  isWriteOnlyMode
} from '../lib/simplifiedSyncService';
import { AppState, AppStateStatus } from 'react-native';

interface SyncManagerProps {
  children?: React.ReactNode;
}

// FORCE RESET MODULE STATE
// This ensures that we always get a fresh module state on component mount
// by adding this here, we prevent any other component from setting the flag first
const resetModuleState = () => {
  // This is a direct call to reset any module-level state in simplifiedSyncService
  try {
    // Use dynamic import to get a fresh instance of the module and reset its state
    import('../lib/simplifiedSyncService').then(module => {
      if (typeof module.markInitialDataLoadComplete === 'function') {
        // This is a hack to reset the initialDataLoadComplete flag
        // It works by setting a property on the module's exported function
        (module.markInitialDataLoadComplete as any).reset = true;
        console.log('FORCE RESET: Module state reset requested');
      }
    });
  } catch (error) {
    console.error('Failed to reset module state:', error);
  }
};

/**
 * SimplifiedSyncManager Component
 * 
 * Handles background synchronization of user profile with Supabase.
 * After initial data load, this component only WRITES data to the database,
 * never reads from it again to prevent duplicate operations.
 */
export const SimplifiedSyncManager: React.FC<SyncManagerProps> = ({ children }) => {
  const { user } = useAuth();
  const dispatch = useAppDispatch();
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const userIdRef = useRef<string | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  
  // Get selector data from Redux store
  const userProfile = useAppSelector(state => state.trivia.userProfile);
  
  // Create a check function for manual use
  const checkDefaultWeights = async () => {
    if (!user || !user.id) return;
    
    // Check if we need to fetch profile data due to default weights
    if (hasAllDefaultWeights(userProfile)) {
      console.log('⚠️ Default weights detected - checking database for actual weights');
      
      try {
        const remoteProfile = await fetchProfileWithDefaultCheck(user.id, userProfile);
        
        if (remoteProfile && !hasAllDefaultWeights(remoteProfile)) {
          console.log('✅ Found non-default weights in database - updating local profile');
          dispatch(loadUserDataSuccess({ 
            profile: remoteProfile,
            timestamp: Date.now()
          }));
          
          // Now we have non-default weights, safe to enter write-only mode
          if (!isWriteOnlyMode()) {
            console.log('✅ Non-default weights retrieved, now entering write-only mode');
            markInitialDataLoadComplete();
          }
        } else {
          console.log('📊 No non-default weights found in database - keeping defaults');
          // Continue allowing database reads since we still have default weights
        }
      } catch (error) {
        console.error('❌ Error checking for default weights:', error);
      }
    } else {
      // We already have non-default weights in memory, make sure we're in write-only mode
      if (!isWriteOnlyMode()) {
        console.log('✅ Local profile already has non-default weights, entering write-only mode');
        markInitialDataLoadComplete();
      }
    }
  };
  
  // Export the function for use by other components
  (SimplifiedSyncManager as any).checkWeights = checkDefaultWeights;
  
  // Run diagnostic check and reset on mount - this must run first
  useEffect(() => {
    console.log('🔥 SimplifiedSyncManager MOUNTED - FORCING MODULE STATE RESET 🔥');
    resetModuleState();
    logSyncStatus();
  }, []);
  
  // Update the ref when user changes
  useEffect(() => {
    if (user && user.id) {
      userIdRef.current = user.id;
    } else {
      userIdRef.current = null;
    }
  }, [user]);
  
  // Check for default weights and load from database if needed
  useEffect(() => {
    // Don't run on first mount, wait for initial data load
    if (initialDataLoaded) {
      checkDefaultWeights();
    }
  }, [user, initialDataLoaded, userProfile, dispatch]);
  
  // Initial data load - do this ONCE when the user logs in
  // This is the ONLY time we read from the database
  useEffect(() => {
    const loadInitialData = async () => {
      if (!user || !user.id || initialDataLoaded) return;
      
      try {
        // Reset module state again here to be sure
        resetModuleState();
        
        dispatch(loadUserDataStart());
        console.log('🔥 SyncManager: FORCED ONE-TIME initial data load 🔥');
        console.log('🔥 SyncManager: BYPASS write-only mode and all caches 🔥');
        
        // Check current sync status before load
        logSyncStatus();
        
        // SUPER FORCE: Directly access the Supabase API if necessary
        // This is a last resort if all else fails
        let forceResult;
        try {
          console.log('🔥 Attempting DIRECT database access 🔥');
          
          // ONE-TIME profile load - FORCED, bypassing all caches
          const { profile: remoteProfile } = await loadUserData(user.id, true);
          forceResult = remoteProfile;
          
          if (remoteProfile) {
            console.log('✅ DIRECT DATABASE ACCESS SUCCESSFUL!');
            console.log(`✅ Got topics with ${Object.keys(remoteProfile.topics || {}).length} entries`);
            console.log(`✅ Got interactions with ${Object.keys(remoteProfile.interactions || {}).length} entries`);
          } else {
            console.log('⚠️ DIRECT DATABASE ACCESS returned null profile');
          }
        } catch (directError) {
          console.error('❌ DIRECT DATABASE ACCESS failed:', directError);
        }
        
        // Proceed with normal flow using the forced result if available
        const remoteProfile = forceResult;
        
        if (remoteProfile) {
          console.log('SyncManager: Remote profile found, comparing timestamps');
          console.log(`Remote lastRefreshed: ${remoteProfile.lastRefreshed}, Local lastRefreshed: ${userProfile.lastRefreshed}`);
          
          // If remote profile is newer than local, update local with remote data
          if (remoteProfile.lastRefreshed > userProfile.lastRefreshed) {
            console.log('SyncManager: Remote profile is newer, updating local profile');
            dispatch(loadUserDataSuccess({ 
              profile: remoteProfile,
              timestamp: Date.now()
            }));
          } else {
            // Check for default weights in local profile but non-default in remote
            const localHasDefaultWeights = hasAllDefaultWeights(userProfile);
            const remoteHasNonDefaultWeights = !hasAllDefaultWeights(remoteProfile);
            
            if (localHasDefaultWeights && remoteHasNonDefaultWeights) {
              console.log('SyncManager: IMPORTANT - Remote profile has non-default weights but local has defaults');
              console.log('SyncManager: Prioritizing remote profile to preserve personalization');
              
              // Use remote profile to preserve personalization
              dispatch(loadUserDataSuccess({ 
                profile: remoteProfile,
                timestamp: Date.now()
              }));
            } else {
              // If local profile is newer, keep local but sync to server
              console.log('SyncManager: Local profile is newer or same age, keeping local but syncing to server');
              await syncUserProfile(user.id, userProfile);
              dispatch(loadUserDataSuccess({ 
                profile: userProfile,
                timestamp: Date.now()
              }));
            }
          }
        } else {
          // If no remote profile exists, use the current one and upload it
          console.log('SyncManager: No remote profile found, creating one from local profile');
          await syncUserProfile(user.id, userProfile);
          dispatch(loadUserDataSuccess({ 
            profile: userProfile,
            timestamp: Date.now()
          }));
        }
        
        console.log('SyncManager: Initial data load complete - NO MORE READS');
        setInitialDataLoaded(true);
        
        // Only enter write-only mode if we have non-default weights 
        // or confirmed that no weights exist in the database
        const profileToCheck = remoteProfile || userProfile;
        if (!hasAllDefaultWeights(profileToCheck)) {
          console.log('SyncManager: Non-default weights found, safe to enter write-only mode');
          markInitialDataLoadComplete();
        } else {
          console.log('SyncManager: WARNING - All weights are default!');
          console.log('SyncManager: Staying in read-write mode until non-default weights are detected');
          // Don't mark initial data load complete yet to allow future reads
        }
        
        // Check sync status after completion
        logSyncStatus();
      } catch (error) {
        console.error('SyncManager: Error loading initial data:', error);
        dispatch(syncFailed());
      }
    };
    
    loadInitialData();
  }, [user, userProfile, initialDataLoaded, dispatch]);
  
  // Listen for app state changes to sync when app goes to background or inactive
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (user && user.id && 
         (appStateRef.current === 'active' && 
          (nextAppState === 'background' || nextAppState === 'inactive'))) {
        console.log('SyncManager: App going to background, writing data (WRITE-ONLY)');
        
        // WRITE-ONLY operation when app goes to background
        dispatch(forceSyncProfile({ userId: user.id }));
      }
      
      appStateRef.current = nextAppState;
    };
    
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => {
      subscription.remove();
    };
  }, [user, dispatch]);
  
  // Final sync when the user logs out or component unmounts
  useEffect(() => {
    return () => {
      const finalSync = async () => {
        if (user && user.id) {
          console.log('SyncManager: Final data write before unmounting (WRITE-ONLY)');
          try {
            // Final write of everything - WRITE-ONLY
            dispatch(forceSyncProfile({ userId: user.id }));
          } catch (error) {
            console.error('SyncManager: Error during final write:', error);
          }
        }
      };
      
      finalSync();
    };
  }, [user, dispatch]);
  
  return <>{children}</>;
}; 