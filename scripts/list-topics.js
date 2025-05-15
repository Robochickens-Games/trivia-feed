// Script to list all unique topics from the trivia_questions table
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './.env' });
require('dotenv').config({ path: './.env.local' });
require('dotenv').config({ path: './.env.development' });

// Get Supabase credentials from environment variables
const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Supabase URL or key not found in environment variables');
  process.exit(1);
}

// Create Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

async function listTopics() {
  try {
    console.log('Fetching unique topics from trivia_questions table...');
    
    // Query to get all unique topics
    const { data, error } = await supabase
      .from('trivia_questions')
      .select('topic')
      .not('topic', 'is', null);
    
    if (error) {
      console.error('Error fetching topics:', error);
      process.exit(1);
    }
    
    if (!data || data.length === 0) {
      console.log('No topics found in the database');
      process.exit(0);
    }
    
    // Extract unique topics
    const topics = [...new Set(data.map(item => item.topic))].filter(Boolean);
    
    // Sort alphabetically
    topics.sort();
    
    // Print results
    console.log('\n=== UNIQUE TOPICS IN DATABASE ===');
    console.log(`Found ${topics.length} unique topics:\n`);
    topics.forEach((topic, index) => {
      console.log(`${index + 1}. ${topic}`);
    });
    
    // Print raw data for debugging
    console.log('\n=== RAW SAMPLE DATA (FIRST 5 ITEMS) ===');
    console.log(JSON.stringify(data.slice(0, 5), null, 2));
    
  } catch (err) {
    console.error('Unexpected error:', err);
    process.exit(1);
  }
}

// Execute the function
listTopics(); 