// Test script for the question generator feature
// Run with: node scripts/test-question-generator.js

// Import required dependencies
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Set hardcoded values for testing - these match app.config.js values
const SUPABASE_URL = "https://vdrmtsifivvpioonpqqc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkcm10c2lmaXZ2cGlvb25wcXFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDYzNDQyMzIsImV4cCI6MjA2MTkyMDIzMn0.OtAUoIz1ZCCE5IncVvpHnDGrTXEQy_JoyvNE0QQf6wA";

console.log('Environment Variables:');
console.log('- SUPABASE URL:', SUPABASE_URL ? 'Using hardcoded value' : 'Missing');
console.log('- SUPABASE KEY:', SUPABASE_KEY ? 'Using hardcoded value' : 'Missing');

// Create a Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Question generation function
async function generateQuestions(topics) {
  console.log(`Generating questions for topics: ${topics.join(', ')}`);
  
  // Define the prompt for the edge function
  const prompt = `Generate 3 unique trivia questions about the following topics: ${topics.join(', ')}. 
  
  Each question should include:
  - A challenging but fair multiple-choice question
  - 4 possible answers (only one correct)
  - The correct answer marked
  - A difficulty level (easy, medium, hard)
  - A "learning capsule" that provides interesting additional context about the answer
  - 2-5 relevant tags
  
  Format your response as a JSON array with objects having this structure:
  {
    "question": "The question text",
    "answers": [
      {"text": "Answer 1", "isCorrect": true},
      {"text": "Answer 2", "isCorrect": false},
      {"text": "Answer 3", "isCorrect": false},
      {"text": "Answer 4", "isCorrect": false}
    ],
    "category": "The primary topic/category",
    "difficulty": "easy|medium|hard",
    "learningCapsule": "Interesting fact about the answer",
    "tags": ["tag1", "tag2", "tag3"]
  }`;
  
  try {
    console.log('Making request to edge function with:');
    console.log('URL:', 'https://vdrmtsifivvpioonpqqc.supabase.co/functions/v1/generateTriviaQuestions');
    console.log('Headers:', {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_KEY.substring(0, 10)}...` // Only log part of the token for security
    });
    console.log('Request body:', JSON.stringify({ prompt }, null, 2));

    const response = await fetch('https://vdrmtsifivvpioonpqqc.supabase.co/functions/v1/generateTriviaQuestions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a specialized trivia question generator that creates high-quality, factually accurate questions for a trivia app.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    
    const responseText = await response.text();
    console.log('Raw response:', responseText);
    
    let responseData;
    try {
      responseData = JSON.parse(responseText);
      console.log('Parsed response:', JSON.stringify(responseData, null, 2));
      
      // Extract the JSON array from the content string
      const content = responseData.choices[0].message.content;
      const jsonMatch = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (!jsonMatch) {
        throw new Error('Failed to find JSON array in response content');
      }
      
      // Parse the JSON array
      const questions = JSON.parse(jsonMatch[0]);
      console.log('Extracted questions:', JSON.stringify(questions, null, 2));
      
      // Add source and timestamp to each question
      return questions.map(q => ({
        ...q,
        source: 'generated',
        created_at: new Date().toISOString()
      }));
    } catch (e) {
      console.error('Failed to parse response:', e);
      throw new Error('Invalid JSON response from edge function');
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}, body: ${responseText}`);
    }
  } catch (error) {
    console.error('Error generating questions:', error);
    throw error;
  }
}

// Generate a fingerprint for a question to detect duplicates
function generateQuestionFingerprint(question, tags) {
  // Normalize the question text
  const normalizedQuestion = question
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Sort and join tags
  const normalizedTags = tags.sort().join('|').toLowerCase();
  
  // Create a simple hash
  return `${normalizedQuestion}|${normalizedTags}`;
}

// Function to save questions to Supabase
async function saveQuestions(questions) {
  let savedCount = 0;
  
  for (const question of questions) {
    // Check if question already exists - use question text as a simple check
    const { data: existingQuestion, error: checkError } = await supabase
      .from('trivia_questions_duplicate')
      .select('id')
      .eq('question_text', question.question)
      .limit(1);
    
    if (checkError) {
      console.error('Error checking for existing question:', checkError);
      continue;
    }
    
    // Skip if question already exists
    if (existingQuestion && existingQuestion.length > 0) {
      console.log('Question already exists, skipping:', question.question.substring(0, 30) + '...');
      continue;
    }
    
    // Prepare question for insertion
    const {
      question: questionText,
      answers,
      category,
      difficulty,
      learningCapsule,
      tags,
      source,
      created_at
    } = question;
    
    // Map answers to the required format for trivia_questions
    const answerChoices = answers.map(a => a.text);
    const correctAnswer = answers.find(a => a.isCorrect)?.text || answerChoices[0];
    
    // Insert question
    const { error } = await supabase
      .from('trivia_questions_duplicate')
      .insert({
        id: 'gen_' + Math.random().toString(36).substring(2, 10), // Generate a unique text ID
        question_text: questionText,
        answer_choices: answerChoices,
        correct_answer: correctAnswer,
        difficulty: difficulty || 'medium',
        language: 'en', // Default to English
        topic: category, // Map category to topic
        subtopic: '', // Default empty subtopic
        branch: '', // Default empty branch
        tags: tags || [],
        tone: 'neutral', // Default tone
        format: 'multiple_choice', // Default format for generated questions
        learning_capsule: learningCapsule || '',
        source: source || 'generated',
        created_at: created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    
    if (error) {
      console.error('Error saving question:', error);
      continue;
    }
    
    savedCount++;
    console.log('Saved question:', question.question.substring(0, 30) + '...');
  }
  
  return savedCount;
}

// Main function to run the test
async function runTest() {
  try {
    console.log('Starting question generator test...');
    
    // Set up test data
    const testTopics = ['Science', 'History', 'Geography'];
    
    // Generate questions
    const generatedQuestions = await generateQuestions(testTopics);
    console.log(`Generated ${generatedQuestions.length} questions`);
    
    // Save questions to database
    const savedCount = await saveQuestions(generatedQuestions);
    console.log(`Saved ${savedCount} new questions to database`);
    
    console.log('Test completed successfully!');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
runTest(); 