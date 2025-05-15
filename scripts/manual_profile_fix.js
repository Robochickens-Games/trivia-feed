#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Replace with your Supabase URL and service key
const supabaseUrl = process.env.SUPABASE_URL || 'https://vdrmtsifivvpioonpqqc.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY; // This needs to be the service_role key

if (!supabaseKey) {
  console.error('Error: SUPABASE_SERVICE_KEY must be provided');
  console.error('Set it in a .env file or as an environment variable');
  process.exit(1);
}

// User ID to fix - will be overridden by command line argument
let userId = process.argv[2];

if (!userId) {
  console.error('Error: User ID must be provided as command line argument');
  console.error('Usage: node manual_profile_fix.js USER_ID');
  process.exit(1);
}

// Create Supabase client with service role key
const supabase = createClient(supabaseUrl, supabaseKey);

async function fixUserProfile() {
  try {
    console.log(`Fixing profile for user: ${userId}`);
    
    // First, check if user exists in auth.users
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
    
    if (userError) {
      console.error('Error fetching user:', userError.message);
      return;
    }
    
    if (!userData || !userData.user) {
      console.error('User not found in auth.users table');
      return;
    }
    
    const user = userData.user;
    console.log(`Found user: ${user.email}`);
    
    // Check if profile already exists
    const { data: existingProfile, error: profileError } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();
      
    if (profileError) {
      console.error('Error checking for existing profile:', profileError.message);
      return;
    }
    
    if (existingProfile) {
      console.log('Profile already exists, no action needed');
      return;
    }
    
    // Create missing profile
    const { data: insertResult, error: insertError } = await supabase
      .from('user_profiles')
      .insert({
        id: userId,
        username: user.email,
        full_name: user.user_metadata?.full_name,
        avatar_url: user.user_metadata?.avatar_url,
        country: user.user_metadata?.country,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      
    if (insertError) {
      console.error('Error creating profile:', insertError.message);
      return;
    }
    
    console.log('Profile created successfully!');
    
    // Verify trigger is working
    const { data: triggerData, error: triggerError } = await supabase.rpc('check_trigger_exists', {
      trigger_name: 'on_auth_user_created'
    });
    
    if (triggerError) {
      console.error('Error checking for trigger:', triggerError.message);
      console.warn('The database trigger might be missing. Check scripts/create_user_profile_table.sql');
    } else {
      if (triggerData) {
        console.log('Database trigger exists and should create profiles for new users');
      } else {
        console.warn('Database trigger is missing! Run the scripts/create_user_profile_table.sql script to fix it');
      }
    }
    
  } catch (error) {
    console.error('Unexpected error:', error.message);
  }
}

fixUserProfile()
  .then(() => console.log('Done'))
  .catch(err => console.error('Failed:', err)); 