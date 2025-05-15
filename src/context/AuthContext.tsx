import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Session, User, AuthChangeEvent } from '@supabase/supabase-js';
import { Alert , Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Define the shape of our auth context
type AuthContextType = {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isGuest: boolean;
  isAuthenticated: boolean;
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<boolean | void>;
  signOut: () => Promise<boolean>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateProfile: (userData: { username?: string; fullName?: string; avatarUrl?: string; country?: string }) => Promise<void>;
  continueAsGuest: () => Promise<void>;
  resendConfirmationEmail: (email: string) => Promise<void>;
  forceRefreshAppState: () => Promise<void>;
};

// Create the context with a default value
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Create a provider component
export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);

  // Initialize auth state when the provider mounts
  useEffect(() => {
    const initAuth = async () => {
      // Check if user is in guest mode from AsyncStorage
      try {
        console.log('Checking for guest mode in AsyncStorage...');
        const guestMode = await AsyncStorage.getItem('guestMode');
        console.log('Guest mode AsyncStorage value:', guestMode);
        
        if (guestMode === 'true') {
          console.log('Found guest mode flag, initializing as guest');
          setIsGuest(true);
          setIsLoading(false);
          return; // Skip Supabase auth check for guest users
        }
      } catch (error) {
        console.error('Error checking guest mode:', error);
      }
      
      // Normal auth flow for non-guest users
      console.log('Checking for existing Supabase session...');
      supabase.auth.getSession().then((response: { data: { session: Session | null } }) => {
        const currentSession = response.data.session;
        console.log('Session check result:', currentSession ? 'Session found' : 'No session found');
        
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        
        // If no session, set guest mode automatically
        if (!currentSession) {
          console.log('No active session found, enabling guest mode');
          setIsGuest(true);
          AsyncStorage.setItem('guestMode', 'true')
            .then(() => console.log('Guest mode flag set in AsyncStorage'))
            .catch(err => console.error('Failed to set guest mode flag:', err));
        }
        
        setIsLoading(false);
      });
    };
    
    initAuth();

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, newSession: Session | null) => {
      console.log('Auth state changed:', _event, newSession ? 'New session' : 'No session');
      
      // Add more debug information for auth diagnostics
      if (newSession) {
        console.log('Session details:', {
          userId: newSession.user.id,
          email: newSession.user.email,
          emailConfirmed: newSession.user.email_confirmed_at ? 'Yes' : 'No',
          aud: newSession.user.aud,
          expiresAt: new Date(newSession.expires_at! * 1000).toISOString()
        });
      }
      
      // If user logs in, clear guest mode
      if (newSession) {
        console.log('User logged in, clearing guest mode');
        
        // Update all state together
        setIsGuest(false);
        setSession(newSession);
        
        // Use type assertion to access user property
        const user = newSession ? (newSession as any).user : null;
        setUser(user);
        
        // Clear guest mode in AsyncStorage
        AsyncStorage.removeItem('guestMode')
          .then(() => console.log('Guest mode flag cleared'))
          .catch(err => console.error('Failed to clear guest mode flag:', err));
      }
      // If user logs out, enable guest mode
      else if (_event === 'SIGNED_OUT') {
        console.log('User signed out, enabling guest mode');
        
        // Update all state together
        setIsGuest(true);
        setUser(null);
        setSession(null);
        
        AsyncStorage.setItem('guestMode', 'true')
          .then(() => console.log('Guest mode flag set on sign out'))
          .catch(err => console.error('Failed to set guest mode flag on sign out:', err));
      } else {
        // For any other events, make sure we update the state
        setSession(newSession);
        
        // Use type assertion to access user property
        const user = newSession ? (newSession as any).user : null;
        setUser(user);
      }
      
      setIsLoading(false);
    });

    // Clean up the subscription when the component unmounts
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Add a helper function to force refresh app state
  const forceRefreshAppState = async () => {
    // Force a small delay to ensure all state updates are processed
    await new Promise(resolve => setTimeout(resolve, 300));
    
    if (Platform.OS === 'web') {
      // For web, we can do a hard refresh which is the most reliable way
      window.location.reload();
    } else {
      // For native, we need to work with the state
      // This is just a backup since we're already updating state 
      // and redirecting the user
      setIsLoading(true);
      await new Promise(resolve => setTimeout(resolve, 200));
      setIsLoading(false);
    }
  };

  // Sign up with email and password
  const signUp = async (email: string, password: string) => {
    try {
      setIsLoading(true);
      console.log('Attempting sign up with email:', email);
      
      // Clear any previous guest mode when signing up
      console.log('Clearing guest mode before sign up');
      await AsyncStorage.removeItem('guestMode');
      setIsGuest(false);
      
      // Proceed with sign up
      console.log('Calling Supabase auth.signUp');
      const { data, error } = await supabase.auth.signUp({ 
        email, 
        password,
        options: {
          // Configure email redirect to the auth callback handler for direct processing
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            // Add some basic user metadata that might help with profile creation
            email: email,
            sign_up_date: new Date().toISOString()
          }
        }
      });
      
      if (error) {
        console.error('Sign up error:', error.message, error.status);
        throw error;
      }
      
      console.log('Sign up response:', {
        user: data.user ? {
          id: data.user.id,
          email: data.user.email,
          identities: data.user.identities?.length || 0
        } : 'No user data',
        session: data.session ? 'Session created' : 'No session',
        userConfirmed: data.user?.email_confirmed_at ? 'Yes' : 'No',
      });
      
      // If we got this far, the auth signup worked - but the profile might not have been created
      // Let's manually check and create it if needed 
      if (data.user) {
        try {
          console.log('Attempting to manually check and create user profile if needed');
          
          // First check if the profile exists
          const { data: profileData, error: profileError } = await supabase
            .from('user_profiles')
            .select('id')
            .eq('id', data.user.id)
            .single();
          
          if (profileError && !profileData) {
            console.log('Profile does not exist, attempting to create manually');
            
            // Extract first two letters from email for the name
            const emailFirstTwoLetters = email.substring(0, 2).toUpperCase();
            
            // Try to create the profile manually
            const { error: insertError } = await supabase
              .from('user_profiles')
              .insert({
                id: data.user.id,
                full_name: emailFirstTwoLetters,
                country: 'OT', // "Other" country code
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              });
            
            if (insertError) {
              console.error('Failed to manually create profile:', insertError);
              // Continue anyway - we'll show a message to the user
            } else {
              console.log('Successfully created user profile manually');
            }
          } else {
            console.log('Profile already exists');
          }
        } catch (profileError) {
          console.error('Error handling profile creation:', profileError);
          // Continue with auth flow even if profile creation failed
        }
      }
      
      if (!data.session) {
        // Email confirmation is required
        console.log('Email confirmation required for new user');
        Alert.alert(
          'Confirmation Email Sent',
          'Please check your email and click the confirmation link to complete your registration. You will be automatically signed in after confirming your email address.',
          [{ text: 'OK', onPress: () => console.log('Email confirmation alert closed') }]
        );
      } else {
        // User was created and auto-confirmed
        console.log('User created and auto-confirmed (no email verification needed)');
        
        // Force immediate state update to ensure UI reflects the signed-in state
        setSession(data.session);
        setUser(data.user);
        setIsGuest(false);
        setIsLoading(false);
        
        // Ensure guest mode is cleared in storage
        await AsyncStorage.removeItem('guestMode');
        
        // Navigation after successful signup
        Alert.alert(
          'Account Created', 
          'Your account has been created successfully.',
          [{ 
            text: 'OK', 
            onPress: async () => {
              console.log('Navigating to home after successful signup');
              
              // Force state refresh before navigation
              await forceRefreshAppState();
              
              // Use appropriate navigation based on platform
              if (Platform.OS === 'web') {
                // Force a full page reload to ensure all components re-render with new auth state
                window.location.href = '/';
              } else {
                // Import router to navigate
                const { router } = require('expo-router');
                router.replace('/');
              }
            }
          }]
        );
      }
    } catch (error: any) {
      console.error('Sign up error:', error.message);
      
      let errorMessage = error.message;
      if (error.message.includes('already registered')) {
        errorMessage = 'This email is already registered. Please sign in instead.';
      } else if (error.message.includes('Database error') || error.status === 500) {
        errorMessage = 'There was a problem creating your account. Please try again or contact support if the problem persists.';
      }
      
      Alert.alert('Sign Up Failed', errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Sign in with email and password
  const signIn = async (email: string, password: string) => {
    try {
      setIsLoading(true);
      console.log('AuthContext: Attempting to sign in with email/password', { email });
      
      // Clear any previous guest mode when signing in
      if (isGuest) {
        console.log('AuthContext: Clearing guest mode before sign in');
        await AsyncStorage.removeItem('guestMode');
        setIsGuest(false);
      }
      
      // Proceed with sign in attempt
      console.log('AuthContext: Calling Supabase signInWithPassword');
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      
      if (error) {
        console.error('AuthContext: Sign in error:', error.message, error.status);
        
        // Special handling for unconfirmed emails
        if (error.message.includes('Email not confirmed')) {
          console.log('AuthContext: Email not confirmed for user');
          Alert.alert(
            'Email Not Confirmed',
            'Your email address has not been confirmed. Would you like to resend the confirmation email?',
            [
              {
                text: 'Cancel',
                style: 'cancel'
              },
              {
                text: 'Resend Email',
                onPress: async () => {
                  try {
                    console.log('AuthContext: User requested to resend confirmation email');
                    const { error: resendError } = await supabase.auth.resend({
                      type: 'signup',
                      email: email,
                    });
                    
                    if (resendError) {
                      console.error('AuthContext: Failed to resend confirmation email:', resendError);
                      
                      // Handle rate limiting errors specifically
                      if (resendError.message.includes('after')) {
                        Alert.alert(
                          'Too Many Requests',
                          'Please wait a minute before requesting another confirmation email.',
                          [{ text: 'OK' }]
                        );
                      } else {
                        Alert.alert('Error', resendError.message);
                      }
                    } else {
                      console.log('AuthContext: Confirmation email resent successfully');
                      Alert.alert(
                        'Confirmation Email Sent',
                        'Please check your email and click the confirmation link to complete your registration.',
                        [{ text: 'OK' }]
                      );
                    }
                  } catch (resendError: any) {
                    console.error('AuthContext: Error in resend flow:', resendError.message);
                    Alert.alert('Error', 'Failed to resend confirmation email. Please try again later.');
                  }
                }
              }
            ]
          );
          return; // Exit the function early
        }
        
        throw error;
      }
      
      if (!data.user || !data.session) {
        console.error('AuthContext: Sign in succeeded but no user or session data returned');
        throw new Error('Authentication succeeded but no user data returned. Please try again.');
      }
      
      console.log('AuthContext: Sign in successful - Response:', {
        user: data.user ? {
          id: data.user.id,
          email: data.user.email,
          emailConfirmed: data.user.email_confirmed_at,
          createdAt: data.user.created_at
        } : 'No user',
        session: data.session ? {
          expiresAt: data.session.expires_at,
          refreshToken: data.session.refresh_token ? 'Present' : 'Missing',
          accessToken: data.session.access_token ? 'Present' : 'Missing',
        } : 'No session'
      });
      
      // Platform-specific post-sign-in handling
      if (Platform.OS === 'ios') {
        console.log('AuthContext: Applying iOS-specific sign-in handling');
        
        // On iOS, we make sure to enforce state updates sequentially with small delays
        // This helps with state synchronization issues that can occur on iOS
        setTimeout(() => {
          setSession(data.session);
          setTimeout(() => {
            setUser(data.user);
            setTimeout(() => {
              console.log('AuthContext: iOS state update sequence completed');
            }, 100);
          }, 100);
        }, 100);
      } else {
        // Standard flow for other platforms
        setSession(data.session);
        setUser(data.user);
      }
      
      // Force a delay to ensure state update is processed
      await new Promise(resolve => setTimeout(resolve, 500));
      
      console.log('AuthContext: Forced state check after delay:', {
        userSet: data.user?.id,
        sessionSet: data.session?.access_token ? 'Present' : 'Missing'
      });
      
      // Force app state refresh
      await forceRefreshAppState();
      
      return true;
    } catch (error: any) {
      console.error('AuthContext: Sign in error:', error.message, error.status || '');
      
      let errorMessage = error.message;
      // Make error messages more user-friendly
      if (error.message.includes('Invalid login credentials')) {
        errorMessage = 'Incorrect email or password. Please try again.';
      }
      
      Alert.alert('Sign In Failed', errorMessage);
      
      // Important: Re-throw the error so calling code can handle it
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // Sign out
  const signOut = async () => {
    try {
      console.log('AuthContext: Starting signOut process');
      setIsLoading(true);
      
      // If already in guest mode, just clear it and return
      if (isGuest) {
        console.log('AuthContext: Clearing guest mode');
        await AsyncStorage.removeItem('guestMode');
        setIsGuest(false);
        setIsLoading(false);
        return true;
      }
      
      // First attempt - Standard signOut with global scope
      console.log('AuthContext: Attempting signOut with global scope');
      const { error: error1 } = await supabase.auth.signOut({ scope: 'global' });
      if (error1) {
        console.warn('AuthContext: First signOut attempt failed:', error1.message);
        // Continue with next approach rather than throwing
      } else {
        console.log('AuthContext: First signOut attempt successful');
      }

      // Second attempt - Forcefully kill the session if first attempt doesn't work
      try {
        console.log('AuthContext: Manually killing session in Supabase');
        await supabase.auth.killSession();
      } catch (killError) {
        console.warn('AuthContext: killSession attempt failed:', killError);
      }

      // Directly manipulate the internal state of the Supabase instance
      try {
        console.log('AuthContext: Manually clearing auth state in Supabase instance');
        // @ts-ignore - Accessing internal methods
        if (supabase.auth.setAuth) {
          // @ts-ignore
          supabase.auth.setAuth(null);
        }
        // @ts-ignore
        if (supabase.auth.clearStore) {
          // @ts-ignore
          await supabase.auth.clearStore();
        }
      } catch (clearError) {
        console.warn('AuthContext: Error clearing auth store:', clearError);
      }

      // Force clear AsyncStorage
      try {
        console.log('AuthContext: Clearing auth from AsyncStorage');
        const keys = await AsyncStorage.getAllKeys();
        const authKeys = keys.filter(key => 
          key.startsWith('supabase.auth') || 
          key.includes('token') || 
          key.includes('session')
        );
        
        if (authKeys.length > 0) {
          console.log('AuthContext: Found auth keys to remove:', authKeys);
          await AsyncStorage.multiRemove(authKeys);
        } else {
          console.log('AuthContext: No auth keys found in AsyncStorage');
        }
      } catch (storageError) {
        console.warn('AuthContext: Error clearing AsyncStorage:', storageError);
      }

      // After signing out, enable guest mode automatically
      console.log('AuthContext: Enabling guest mode after sign out');
      setIsGuest(true);
      await AsyncStorage.setItem('guestMode', 'true');
      
      // Explicitly reset the React state
      console.log('AuthContext: Resetting auth state in React context');
      setUser(null);
      setSession(null);

      console.log('AuthContext: SignOut process completed');
      
      // Force a small delay to ensure all async operations complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      return true;
    } catch (error: any) {
      console.error('AuthContext: Error during signOut process:', error.message);
      
      // Even if there was an error, try to enable guest mode
      try {
        console.log('AuthContext: Attempting to enable guest mode after error');
        setIsGuest(true);
        await AsyncStorage.setItem('guestMode', 'true');
      } catch (guestError) {
        console.error('AuthContext: Failed to enable guest mode after error:', guestError);
      }
      
      Alert.alert('Error', 'Failed to sign out properly. Please restart the app.');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  // Google sign in - disabled
  const signInWithGoogle = async () => {
    Alert.alert(
      'Feature Not Available',
      'Sign in with Google is currently not supported.'
    );
    return;
  };

  // Apple sign in - disabled
  const signInWithApple = async () => {
    Alert.alert(
      'Feature Not Available',
      'Sign in with Apple is currently not supported.'
    );
    return;
  };

  // Reset password
  const resetPassword = async (email: string) => {
    try {
      setIsLoading(true);
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: makeRedirectUri({
          scheme: 'trivia-universe-feed',
          path: 'reset-password'
        }),
      });
      
      if (error) {
        throw error;
      }
      
      Alert.alert('Success', 'Check your email for the password reset link');
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Update user profile
  const updateProfile = async (userData: { username?: string; fullName?: string; avatarUrl?: string; country?: string }) => {
    try {
      setIsLoading(true);

      if (!user) {
        throw new Error('User not authenticated');
      }

      // Update the profile in our user_profiles table
      const { error } = await supabase
        .from('user_profiles')
        .update({
          full_name: userData.fullName,
          avatar_url: userData.avatarUrl,
          country: userData.country,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (error) {
        throw error;
      }

      Alert.alert('Success', 'Profile updated successfully');
    } catch (error: any) {
      Alert.alert('Error updating profile', error.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Continue as guest function
  const continueAsGuest = async () => {
    try {
      setIsLoading(true);
      console.log('Setting up guest mode');
      
      // Only sign out if we're authenticated to avoid unnecessary operations
      if (user || session) {
        console.log('Clearing existing auth session before enabling guest mode');
        await signOut();
      }
      
      // Set guest mode flag in AsyncStorage - do this before state updates to ensure it's saved
      await AsyncStorage.setItem('guestMode', 'true');
      console.log('Guest mode flag saved in AsyncStorage');
      
      // Update state
      setIsGuest(true);
      setUser(null);
      setSession(null);
      
      // On iOS, ensure changes are applied sequentially with small delays
      if (Platform.OS === 'ios') {
        console.log('iOS platform: applying sequential state updates with delays');
        // Force a small delay to ensure state updates are processed
        return new Promise<void>(resolve => {
          setTimeout(() => {
            console.log('Guest mode activation complete on iOS');
            setIsLoading(false);
            resolve();
          }, 100);
        });
      }
      
      console.log('Guest mode activated successfully');
    } catch (error) {
      console.error('Error setting up guest mode:', error);
      
      // Try one more time directly
      try {
        console.log('Retrying guest mode activation directly');
        setIsGuest(true);
        await AsyncStorage.setItem('guestMode', 'true');
      } catch (retryError) {
        console.error('Retry also failed:', retryError);
        Alert.alert('Error', 'Failed to continue as guest. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Add a new function to resend confirmation email
  const resendConfirmationEmail = async (email: string) => {
    try {
      setIsLoading(true);
      console.log('Attempting to resend confirmation email to:', email);
      
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email,
        options: {
          // Use the dedicated auth callback handler for more robust processing
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        }
      });
      
      if (error) {
        console.error('Failed to resend confirmation email:', error);
        
        // Handle rate limiting errors specifically
        if (error.message.includes('after')) {
          Alert.alert(
            'Too Many Requests',
            'Please wait a minute before requesting another confirmation email.',
            [{ text: 'OK' }]
          );
        } else {
          Alert.alert('Error', error.message);
        }
        throw error;
      }
      
      console.log('Confirmation email resent successfully');
      Alert.alert(
        'Confirmation Email Sent',
        'Please check your email and click the confirmation link to complete your registration. You will be automatically signed in after confirming.',
        [{ text: 'OK' }]
      );
    } catch (error: any) {
      console.error('Error resending confirmation email:', error.message);
      // The error alert is already handled above
    } finally {
      setIsLoading(false);
    }
  };

  // Provide the auth context to children components
  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        isGuest,
        isAuthenticated: !!user,
        signUp,
        signIn,
        signOut,
        signInWithGoogle,
        signInWithApple,
        resetPassword,
        updateProfile,
        continueAsGuest,
        resendConfirmationEmail,
        forceRefreshAppState
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// Create a hook for easy context consumption
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 