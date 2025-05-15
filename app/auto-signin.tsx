import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useAuth } from '../src/context/AuthContext';
import { supabase } from '../src/lib/supabaseClient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';

export default function AutoSignInScreen() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing your authentication...');
  const router = useRouter();
  const params = useLocalSearchParams();
  const source = params.source as string;
  const { forceRefreshAppState } = useAuth();
  
  useEffect(() => {
    const processSignIn = async () => {
      try {
        console.log('Auto-signin page loaded, processing authentication...');
        
        // Remove guest mode flag immediately
        await AsyncStorage.removeItem('guestMode');
        console.log('Removed guest mode flag');
        
        // For web, we need to explicitly get the session from the URL
        if (Platform.OS === 'web') {
          console.log('Web platform detected, checking for auth in URL...');
          
          // IMPORTANT: Supabase automatically tries to handle auth from URL
          // We need to explicitly trigger a session refresh to get the latest state
          console.log('Calling Supabase to get current session...');
          const { data, error } = await supabase.auth.getSession();
          
          console.log('Session check result:', 
            data?.session ? 'Session found' : 'No session found',
            error ? `Error: ${error.message}` : 'No error'
          );
          
          if (error) {
            console.error('Error getting session:', error);
            setStatus('error');
            setMessage('Failed to authenticate. Please try logging in manually.');
            return;
          }
          
          if (data?.session) {
            console.log('Valid session found! User is authenticated.');
            console.log('Session details:', {
              user: data.session.user.id,
              expiresAt: data.session.expires_at
            });
            
            // Explicitly set the session in Supabase to ensure it's stored properly
            // @ts-ignore - Accessing internal method
            if (supabase.auth.setSession) {
              console.log('Setting session in Supabase internally');
              // @ts-ignore
              await supabase.auth.setSession(data.session);
            }
            
            setStatus('success');
            setMessage('Your email has been confirmed and you are now signed in! Redirecting...');
            
            // Force the app state to refresh
            await forceRefreshAppState();
            
            // Redirect after a short delay
            setTimeout(() => {
              // Use a hard redirect for web to ensure a clean URL and state
              console.log('Redirecting to home...');
              window.location.href = '/';
            }, 1500);
            return;
          } else {
            console.log('No session found after auth callback');
            
            // Try to explicitly parse the URL hash
            if (window.location.hash && window.location.hash.includes('access_token')) {
              console.log('Auth tokens found in URL, manually setting session...');
              try {
                // This will set the session from URL
                const { data: hashData, error: hashError } = 
                  await supabase.auth.getSessionFromUrl();
                  
                if (hashError) {
                  console.error('Error setting session from URL:', hashError);
                  throw hashError;
                }
                
                if (hashData?.session) {
                  console.log('Successfully set session from URL');
                  
                  setStatus('success');
                  setMessage('Authentication successful! Redirecting...');
                  
                  await forceRefreshAppState();
                  
                  setTimeout(() => {
                    window.location.href = '/';
                  }, 1500);
                  return;
                }
              } catch (urlError) {
                console.error('Error processing URL auth:', urlError);
              }
            }
          }
        }
        
        // If we get here, we didn't find a session from the URL
        // Try to get the current session as a fallback
        console.log('No session from URL, checking for existing session...');
        const { data: sessionData } = await supabase.auth.getSession();
        
        if (sessionData?.session) {
          console.log('Found existing session, user is already authenticated');
          setStatus('success');
          setMessage('You are already signed in. Redirecting...');
          
          // Redirect after a short delay
          setTimeout(() => {
            if (Platform.OS === 'web') {
              window.location.href = '/';
            } else {
              router.replace('/');
            }
          }, 1500);
        } else {
          console.log('No valid session found after authentication attempt');
          setStatus('error');
          setMessage('Authentication failed. Please try signing in manually.');
        }
      } catch (err) {
        console.error('Error in auto sign-in process:', err);
        setStatus('error');
        setMessage('An unexpected error occurred. Please try logging in manually.');
      }
    };
    
    processSignIn();
  }, [router, source, forceRefreshAppState]);
  
  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      
      {status === 'loading' && (
        <ActivityIndicator size="large" color="#3498db" />
      )}
      
      <Text style={[
        styles.message,
        status === 'success' ? styles.successText : 
        status === 'error' ? styles.errorText : null
      ]}>
        {message}
      </Text>
      
      {status === 'error' && (
        <Text 
          style={styles.linkText}
          onPress={() => {
            if (Platform.OS === 'web') {
              window.location.href = '/auth/login';
            } else {
              router.replace('/auth/login');
            }
          }}
        >
          Go to login
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  message: {
    fontSize: 18,
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 20,
  },
  successText: {
    color: '#2ecc71',
  },
  errorText: {
    color: '#e74c3c',
  },
  linkText: {
    color: '#3498db',
    fontSize: 16,
    marginTop: 10,
    textDecorationLine: 'underline',
  },
}); 