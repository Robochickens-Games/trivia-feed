import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

console.log('DEBUG: Initializing Supabase client');

let supabaseUrl = '';
let supabaseAnonKey = '';

// First check values in app.config.js (which can read from .env files during build)
const extraFromConfig = Constants.expoConfig?.extra;

// Debug what's available in Constants.expoConfig
console.log('DEBUG: Constants.expoConfig =', JSON.stringify(Constants.expoConfig, null, 2));

if (extraFromConfig) {
  console.log('DEBUG: Checking app.config.js for Supabase credentials');
  
  if (extraFromConfig.supabaseUrl) {
    console.log(`DEBUG: Found Supabase URL in app.config.js: ${extraFromConfig.supabaseUrl}`);
    supabaseUrl = extraFromConfig.supabaseUrl;
  }
  
  if (extraFromConfig.supabaseAnonKey) {
    console.log('DEBUG: Found Supabase key in app.config.js (key not shown for security)');
    supabaseAnonKey = extraFromConfig.supabaseAnonKey;
  }
}

// Fallback to Expo environment variables directly if needed
if (!supabaseUrl && process.env.EXPO_PUBLIC_SUPABASE_URL) {
  console.log(`DEBUG: Found Supabase URL in Expo env variables: ${process.env.EXPO_PUBLIC_SUPABASE_URL}`);
  supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
}

if (!supabaseAnonKey && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
  console.log('DEBUG: Found Supabase key in Expo env variables (key not shown for security)');
  supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
}

// OVERRIDE URL FOR TESTING - FORCE THE CORRECT ONE
supabaseUrl = "https://vdrmtsifivvpioonpqqc.supabase.co";
console.log(`DEBUG: FORCING Supabase URL to: ${supabaseUrl}`);

// Validate the URL format to catch obvious issues early
if (supabaseUrl) {
  try {
    const url = new URL(supabaseUrl);
    console.log(`DEBUG: Validated Supabase URL format, hostname: ${url.hostname}`);
    
    // Basic check to make sure it's a Supabase domain
    if (!url.hostname.includes('supabase.co')) {
      console.warn('DEBUG: URL doesn\'t appear to be a supabase.co domain. This might be intentional for custom domains.');
    }
  } catch (error: any) {
    console.error(`DEBUG: Invalid Supabase URL format: ${error.message}`);
  }
}

// Log final status
console.log(`DEBUG: Final status - URL: ${supabaseUrl}, Key: ${supabaseAnonKey ? 'Key is set (not shown)' : 'Not set'}`);

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase credentials missing. Make sure to set credentials in .env file for app.config.js or as EXPO_PUBLIC environment variables.'
  );
}

// Declare the supabase client variable first
let supabase: any;

try {
  // Initialize the Supabase client
  console.log('DEBUG: Creating Supabase client...');
  console.log(`DEBUG: Using URL: ${supabaseUrl}`);
  
  // Check for network connectivity before creating client
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase credentials');
  }
  
  supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
  
  console.log('DEBUG: Supabase client created successfully');
} catch (error: any) {
  console.error('DEBUG: Failed to create Supabase client:', error);
  
  // Create a dummy client that logs errors but falls back gracefully
  supabase = new Proxy({}, {
    get: function(obj, prop) {
      if (typeof prop === 'string') {
        // For from() method, return a special handler that can be chained
        if (prop === 'from') {
          return (tableName: string) => {
            console.warn(`DEBUG: Attempting to access table '${tableName}' with non-functional Supabase client. Will return mock data if available.`);
            
            // Return an object that mimics Supabase query builder
            return {
              select: () => {
                console.warn('DEBUG: select() called on non-functional client');
                return Promise.resolve({ data: null, error: { message: 'Supabase client not initialized or network unavailable' } });
              },
              insert: () => {
                console.warn('DEBUG: insert() called on non-functional client');
                return Promise.resolve({ data: null, error: { message: 'Supabase client not initialized or network unavailable' } });
              },
              update: () => {
                console.warn('DEBUG: update() called on non-functional client');
                return Promise.resolve({ data: null, error: { message: 'Supabase client not initialized or network unavailable' } });
              },
              delete: () => {
                console.warn('DEBUG: delete() called on non-functional client');
                return Promise.resolve({ data: null, error: { message: 'Supabase client not initialized or network unavailable' } });
              },
              // Add other Supabase query methods as needed
            };
          };
        }
        
        // Return a function that logs the error for other methods
        return () => {
          console.warn(`DEBUG: Supabase client not initialized. Cannot call '${prop}'. Will use mock data if available.`);
          return { data: null, error: { message: 'Supabase client not initialized or network unavailable' } };
        };
      }
      return undefined;
    }
  });
}

// Export the client
export { supabase }; 