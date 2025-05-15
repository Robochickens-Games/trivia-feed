import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabaseClient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';

// This is a dedicated callback handler for Supabase authentication
export default function AuthCallbackScreen() {
  const [message, setMessage] = useState('Processing authentication...');
  const [isError, setIsError] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Function to handle the auth callback
    const handleAuthCallback = async () => {
      try {
        console.log('Auth callback screen loaded - processing authentication...');
        
        // Clear guest mode immediately
        await AsyncStorage.removeItem('guestMode');
        console.log('Cleared guest mode flag');

        if (Platform.OS === 'web') {
          // Get the current URL to extract tokens
          const url = window.location.href;
          console.log('Current URL:', url.slice(0, 30) + '...' + url.slice(-10));
          
          // In Supabase v2.49.4, we don't need to explicitly call getSessionFromUrl
          // The tokens are automatically picked up from the URL hash by the Supabase client
          
          // Let's check if we have a session after the redirect
          const { data, error } = await supabase.auth.getSession();
          
          if (error) {
            console.error('Error getting session:', error);
            setIsError(true);
            setMessage('Authentication failed: ' + error.message);
            return;
          }
          
          if (data?.session) {
            console.log('Successfully authenticated!', {
              userId: data.session.user.id,
              email: data.session.user.email
            });
            
            setMessage('Authentication successful! Redirecting...');
            
            // Store a flag to indicate successful authentication for debugging
            localStorage.setItem('auth_callback_success', 'true');
            localStorage.setItem('auth_callback_time', new Date().toISOString());
            
            // Redirect to home page after a brief delay
            setTimeout(() => {
              console.log('Redirecting to home page...');
              // Use a complete URL reload to ensure clean state
              window.location.href = '/';
            }, 1500);
          } else {
            console.log('No session data returned from auth callback');
            
            // Try to manually construct the session from URL parameters if present
            const hash = window.location.hash;
            if (hash && hash.includes('access_token')) {
              console.log('Found access_token in URL, refreshing page to complete authentication...');
              // Force a reload to make Supabase process the URL parameters
              window.location.reload();
              return;
            }
            
            setIsError(true);
            setMessage('Authentication failed: No session data returned');
          }
        } else {
          // Handle native platforms (should not typically reach here)
          console.log('Native platform detected in auth callback');
          router.replace('/');
        }
      } catch (error) {
        console.error('Error in auth callback handler:', error);
        setIsError(true);
        setMessage('An unexpected error occurred during authentication');
      }
    };

    handleAuthCallback();
  }, [router]);

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <ActivityIndicator size="large" color="#3498db" style={styles.loader} />
      <Text style={[styles.message, isError && styles.errorText]}>
        {message}
      </Text>
      
      {isError && (
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
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  loader: {
    marginBottom: 20,
  },
  message: {
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 20,
  },
  errorText: {
    color: '#e74c3c',
  },
  linkText: {
    color: '#3498db',
    fontSize: 16,
    textDecorationLine: 'underline',
  },
}); 