import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { 
  startSync, 
  finishSync, 
  syncFailed,
  updateUserProfile,
  loadUserDataStart,
  loadUserDataSuccess
} from '../store/triviaSlice';
import type { UserProfile } from '../lib/personalizationService';
import { 
  syncUserProfile,
  fetchUserProfile
} from '../lib/simplifiedSyncService';
import { View, Text, StyleSheet } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';

interface SyncManagerProps {
  children?: React.ReactNode;
}

/**
 * SyncManager Component
 * 
 * Handles background synchronization of user profile with Supabase
 * when the user is authenticated. Uses a simplified approach with
 * all data in a single table.
 */
export const SyncManager: React.FC<SyncManagerProps> = ({ children }) => {
  const { user } = useAuth();
  const dispatch = useAppDispatch();
  const [initialized, setInitialized] = useState(false);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const userIdRef = useRef<string | null>(null);
  
  // Get selector data from Redux store
  const userProfile = useAppSelector(state => state.trivia.userProfile);
  const lastSyncTime = useAppSelector(state => state.trivia.lastSyncTime);
  const isSyncing = useAppSelector(state => state.trivia.isSyncing);
  
  // Update the ref when user changes
  useEffect(() => {
    if (user && user.id) {
      userIdRef.current = user.id;
    } else {
      userIdRef.current = null;
    }
  }, [user]);
  
  // Initial data load - do this once when the user logs in
  useEffect(() => {
    const loadInitialData = async () => {
      if (!user || !user.id || initialDataLoaded) return;
      
      try {
        dispatch(loadUserDataStart());
        console.log('SyncManager: Loading initial user data');
        
        // Load user profile from database
        const profile = await fetchUserProfile(user.id);
        
        if (profile) {
          dispatch(loadUserDataSuccess({ 
            profile,
            timestamp: Date.now()
          }));
        } else {
          // If no profile exists, use the current one and upload it
          await syncUserProfile(user.id, userProfile);
          dispatch(loadUserDataSuccess({ 
            profile: userProfile,
            timestamp: Date.now()
          }));
        }
        
        setInitialDataLoaded(true);
      } catch (error) {
        console.error('SyncManager: Error loading initial data:', error);
        dispatch(syncFailed());
      }
    };
    
    loadInitialData();
  }, [user, userProfile, initialDataLoaded, lastSyncTime, dispatch]);
  
  // Fetch remote profile on initial load when authenticated
  useEffect(() => {
    const initializeProfile = async () => {
      if (user && !initialized) {
        console.log('SyncManager: Initializing profile for user', user.id);
        
        try {
          dispatch(startSync());
          
          // Fetch the remote profile
          const remoteProfile = await fetchUserProfile(user.id);
          
          if (remoteProfile) {
            console.log('SyncManager: Remote profile found, updating local profile');
            
            // If the remote profile is newer than our local profile, use it
            if (remoteProfile.lastRefreshed > userProfile.lastRefreshed) {
              dispatch(updateUserProfile({ 
                profile: remoteProfile,
                userId: user.id
              }));
              console.log('SyncManager: Updated local profile with remote data');
            } else {
              // If our local profile is newer, sync it to the server
              console.log('SyncManager: Local profile is newer, syncing to server');
              await syncUserProfile(user.id, userProfile);
            }
          } else {
            // No remote profile exists, create one
            console.log('SyncManager: No remote profile found, creating one');
            await syncUserProfile(user.id, userProfile);
          }
          
          dispatch(finishSync(Date.now()));
          setInitialized(true);
        } catch (error) {
          console.error('SyncManager: Error initializing profile:', error);
          dispatch(syncFailed());
        }
      }
    };
    
    initializeProfile();
  }, [user, initialized, dispatch, userProfile]);
  
  // Periodically sync changes to the server (every 5 minutes instead of every minute)
  useEffect(() => {
    if (!user) return;
    
    const syncInterval = setInterval(async () => {
      if (isSyncing || !user.id) return;
      
      try {
        dispatch(startSync());
        console.log('SyncManager: Running periodic sync');
        
        // Sync profile (now includes interactions as JSON)
        await syncUserProfile(user.id, userProfile);
        
        dispatch(finishSync(Date.now()));
      } catch (error) {
        console.error('SyncManager: Error during periodic sync:', error);
        dispatch(syncFailed());
      }
    }, 5 * 60 * 1000); // Sync every 5 minutes (reduced frequency)
    
    return () => {
      clearInterval(syncInterval);
    };
  }, [user, isSyncing, userProfile, dispatch]);
  
  // Final sync when the user logs out
  useEffect(() => {
    return () => {
      const finalSync = async () => {
        if (user && user.id) {
          console.log('SyncManager: Performing final sync before unmounting');
          try {
            // Final sync of everything
            await syncUserProfile(user.id, userProfile);
          } catch (error) {
            console.error('SyncManager: Error during final sync:', error);
          }
        }
      };
      
      finalSync();
    };
  }, [user, userProfile]);
  
  return <>{children}</>;
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 5,
    borderRadius: 5
  },
  text: {
    color: 'white',
    fontSize: 12
  }
}); 