import { AppDispatch } from './index';
import { loadUserDataStart, loadUserDataSuccess, loadUserDataFailure } from './triviaSlice';
import { loadUserData } from '../lib/syncService';

/**
 * Thunk to load all user data from the server
 * This ensures consistency across sessions and platforms
 */
export const loadUserDataThunk = (userId: string) => async (dispatch: AppDispatch) => {
  try {
    // Start loading process
    dispatch(loadUserDataStart({ userId }));
    
    console.log('Loading user data with weight-related operations disabled.');
    
    // Load all user data (note: syncService has been modified to not fetch weight data)
    const userData = await loadUserData(userId);
    
    // Successfully loaded data
    dispatch(loadUserDataSuccess({
      ...userData,
      timestamp: Date.now()
    }));
    
    return userData;
  } catch (error) {
    console.error('Error in loadUserDataThunk:', error);
    
    // Handle failure
    dispatch(loadUserDataFailure());
    
    return {
      profile: null,
      interactions: [],
      feedChanges: [],
      weightChanges: []
    };
  }
}; 