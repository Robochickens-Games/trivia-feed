import { supabase } from './supabaseClient';
import { getTopicColor } from './colors';
import { getStandardizedTopicName } from '../constants/topics';

// Define the type of trivia question from Supabase
export interface TriviaQuestion {
  id: string;
  question_text?: string;
  question?: string;
  answer_choices?: string[];
  answers?: {text: string, isCorrect: boolean}[];
  correct_answer?: string;
  difficulty?: string;
  topic?: string;
  subtopic?: string;
  branch?: string;
  category?: string;
  image_url?: string;
  learning_capsule?: string;
  explanation?: string;
  tags?: string[];
  language?: string;
}

// Define the app's feed item format that matches our existing components
export interface FeedItem {
  id: string;
  topic: string;
  question: string;
  answers: {
    text: string;
    isCorrect: boolean;
  }[];
  difficulty: string;
  likes: number;
  views: number;
  backgroundColor: string;
  learningCapsule: string;
  tags?: string[];
  subtopic?: string;
  branch?: string;
}

// Add a new interface to track question generation events
export interface GeneratorEvent {
  timestamp: number;
  userId: string;
  primaryTopics: string[];
  adjacentTopics: string[];
  questionsGenerated: number;
  questionsSaved: number;
  success: boolean;
  error?: string;
  status?: string; // Add status field for 'starting', etc.
}

// Mock data to use if Supabase fails
const mockFeedData: FeedItem[] = [
  {
    id: '1',
    topic: 'Science',
    question: 'What is the closest star to Earth?',
    answers: [
      { text: 'The Sun', isCorrect: true },
      { text: 'Proxima Centauri', isCorrect: false },
      { text: 'Alpha Centauri', isCorrect: false },
      { text: 'Sirius', isCorrect: false }
    ],
    difficulty: 'Easy',
    likes: 1245,
    views: 5800,
    backgroundColor: getTopicColor('Science'),
    learningCapsule: 'The Sun is about 93 million miles (150 million km) from Earth and is a G-type main-sequence star.'
  },
  {
    id: '2',
    topic: 'History',
    question: 'Who was the first President of the United States?',
    answers: [
      { text: 'George Washington', isCorrect: true },
      { text: 'Thomas Jefferson', isCorrect: false },
      { text: 'John Adams', isCorrect: false },
      { text: 'Benjamin Franklin', isCorrect: false }
    ],
    difficulty: 'Easy',
    likes: 842,
    views: 3200,
    backgroundColor: getTopicColor('History'),
    learningCapsule: 'George Washington served as the first President from 1789 to 1797 and is often called the "Father of His Country".'
  },
  {
    id: '3',
    topic: 'Geography',
    question: 'What is the largest ocean on Earth?',
    answers: [
      { text: 'The Pacific Ocean', isCorrect: true },
      { text: 'The Atlantic Ocean', isCorrect: false },
      { text: 'The Indian Ocean', isCorrect: false },
      { text: 'The Arctic Ocean', isCorrect: false }
    ],
    difficulty: 'Medium',
    likes: 756,
    views: 2900,
    backgroundColor: getTopicColor('Geography'),
    learningCapsule: 'The Pacific Ocean covers more than 30% of Earth\'s surface and contains more than half of the free water on Earth.'
  }
];

// Function to inspect table structure
async function inspectTableStructure() {
  try {
    console.log('Inspecting trivia_questions table structure...');
    // Get a sample row to analyze the structure
    const { data, error } = await supabase
      .from('trivia_questions')
      .select('*')
      .limit(1);
      
    if (error) {
      console.error('Error fetching sample data:', error);
      return;
    }
    
    if (data && data.length > 0) {
      const sample = data[0];
      console.log('Sample row fields:', Object.keys(sample));
      
      // Log specific important fields
      console.log('Question field:', sample.question_text || sample.question || 'not found');
      console.log('Answer choices:', sample.answer_choices ? 
        (Array.isArray(sample.answer_choices) ? 'array with ' + sample.answer_choices.length + ' items' : typeof sample.answer_choices) : 'not found');
      console.log('Correct answer:', sample.correct_answer || 'not found');
      console.log('Full sample:', JSON.stringify(sample, null, 2));
    } else {
      console.log('No sample data found');
    }
  } catch (e) {
    console.error('Error during inspection:', e);
  }
}

// Function to specifically analyze correct answers format in the database
export async function analyzeCorrectAnswers() {
  try {
    console.log('Analyzing correct answer formats in database...');
    
    // Fetch a few questions to analyze
    const { data, error } = await supabase
      .from('trivia_questions')
      .select('*')
      .limit(5);
    
    if (error) {
      console.error('Error fetching data for analysis:', error);
      return;
    }
    
    if (!data || data.length === 0) {
      console.log('No data found for analysis');
      return;
    }
    
    // Analyze each question
    data.forEach((question: TriviaQuestion, index: number) => {
      console.log(`\n--- Question ${index + 1} ---`);
      console.log(`Question: ${question.question_text || question.question || 'unknown'}`);
      
      // Check answer_choices format
      if (question.answer_choices) {
        console.log(`answer_choices type: ${typeof question.answer_choices}`);
        if (Array.isArray(question.answer_choices)) {
          console.log(`answer_choices: [${question.answer_choices.join(', ')}]`);
        } else {
          console.log(`answer_choices: ${JSON.stringify(question.answer_choices)}`);
        }
      } else {
        console.log('answer_choices: not present');
      }
      
      // Check correct_answer format
      if (question.correct_answer) {
        console.log(`correct_answer type: ${typeof question.correct_answer}`);
        console.log(`correct_answer: ${question.correct_answer}`);
        
        // Check if correct_answer matches any of the answer_choices
        if (Array.isArray(question.answer_choices)) {
          const foundIndex = question.answer_choices.findIndex(
            (choice: string | any) => String(choice) === String(question.correct_answer)
          );
          
          if (foundIndex !== -1) {
            console.log(`MATCH: correct_answer matches answer_choices[${foundIndex}]`);
          } else {
            console.log('WARNING: correct_answer does not match any answer_choices');
            console.log('This might indicate a data issue or a string format difference');
            
            // Try more lenient matching to debug
            const possibleMatches = question.answer_choices.map((choice: string | any, idx: number) => {
              return {
                index: idx,
                choice: String(choice),
                similarity: String(choice).toLowerCase().includes(String(question.correct_answer).toLowerCase()) ||
                            String(question.correct_answer).toLowerCase().includes(String(choice).toLowerCase())
              };
            }).filter((m: {similarity: boolean}) => m.similarity);
            
            if (possibleMatches.length > 0) {
              console.log('Possible partial matches:', possibleMatches);
            }
          }
        }
      } else {
        console.log('correct_answer: not present');
      }
    });
    
  } catch (e) {
    console.error('Error during correct answer analysis:', e);
  }
}

// Function to fetch trivia questions from Supabase
export async function fetchTriviaQuestions(limit: number = 20, language: string = 'English'): Promise<FeedItem[]> {
  // Note: Caching of trivia questions is implemented in the FeedScreen component
  // using AsyncStorage to improve loading performance and provide offline capability
  try {
    console.log('DEBUG: Starting to fetch data from Supabase - requesting ALL questions');
    
    // Log basic info without accessing protected properties
    // @ts-ignore - We need to access this for debugging
    console.log(`DEBUG: Supabase URL being used: ${supabase?.url || supabase?.supabaseUrl || 'Unknown'}`);
    console.log(`DEBUG: Attempting to connect to Supabase database`);
    
    try {
      // Test the connection with a simple query
      const { count, error: pingError } = await supabase
        .from('trivia_questions')
        .select('*', { count: 'exact', head: true });
        
      if (pingError) {
        console.error('DEBUG: Connection test failed:', pingError);
        throw new Error(`Connection test failed: ${pingError.message}`);
      }
      
      console.log(`DEBUG: Connection test successful! Database has ${count} records in trivia_questions table.`);
    } catch (pingError) {
      console.error('DEBUG: Connection test error:', pingError);
      console.log('DEBUG: Falling back to mock data due to connection error');
      return mockFeedData;
    }
    
    // If we made it here, the connection test was successful, try to get actual data
    try {
      // First inspect the table structure
      await inspectTableStructure();
      
      // Get total count of records in the database
      const { count: totalCount, error: countError } = await supabase
        .from('trivia_questions')
        .select('*', { count: 'exact', head: true });
        
      if (countError) {
        console.error('Error getting total count:', countError);
        return mockFeedData;
      } else {
        console.log(`DEBUG: Total questions in database: ${totalCount}`);
      }
      
      // Fetch the actual data - remove the limit to get all questions
      console.log('DEBUG: Fetching all questions from database...');
      const { data, error } = await supabase
        .from('trivia_questions')
        .select('*');

      console.log('DEBUG: Supabase response:', data ? `Got ${data.length} records` : 'No data', error ? `Error: ${error.message}` : 'No error');
      
      if (error) {
        console.error('Error fetching trivia questions:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        return mockFeedData;
      }

      if (!data || data.length === 0) {
        console.warn('No trivia questions found, using mock data instead');
        return mockFeedData;
      }

      console.log('DEBUG: Successfully retrieved data from Supabase');
      
      // Transform the Supabase data to match our app's format
      return data.map((question: TriviaQuestion) => {
        // Determine the question text
        const questionText = question.question_text || question.question || 'Unknown question';
        
        // Handle answers - this is the critical part that needs adjustment based on inspection
        let answers: { text: string, isCorrect: boolean }[] = [];
        
        // Case 1: Pre-formatted answers array with isCorrect flags
        if (question.answers && Array.isArray(question.answers)) {
          answers = question.answers;
        }
        // Case 2: answer_choices array + separate correct_answer
        else if (question.answer_choices && Array.isArray(question.answer_choices)) {
          if (question.correct_answer) {
            const correctAnswerStr = String(question.correct_answer).trim();
            
            // Create a normalized version for comparison (lowercase, no punctuation)
            const normalizeString = (str: string): string => {
              return str.toLowerCase()
                .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
                .replace(/\s+/g, " ")
                .trim();
            };
            
            const normalizedCorrectAnswer = normalizeString(correctAnswerStr);
            
            // Try three matching approaches:
            // 1. Exact string match
            // 2. Normalized string match (case insensitive, punctuation removed)
            // 3. Substring match (is correct answer contained in the choice or vice versa)
            answers = question.answer_choices.map((choice: any) => {
              const choiceStr = String(choice).trim();
              const normalizedChoice = normalizeString(choiceStr);
              
              // Try different matching strategies in order of strictness
              const exactMatch = choiceStr === correctAnswerStr;
              const normalizedMatch = normalizedChoice === normalizedCorrectAnswer;
              const substringMatch = normalizedChoice.includes(normalizedCorrectAnswer) || 
                                   normalizedCorrectAnswer.includes(normalizedChoice);
              
              return {
                text: choiceStr,
                isCorrect: exactMatch || normalizedMatch || substringMatch
              };
            });
            
            // Log for debugging
            console.log(`Question "${questionText}" - correct answer from DB: "${question.correct_answer}"`);
            
            // Check if we successfully marked any answer as correct
            const hasCorrectAnswer = answers.some(a => a.isCorrect);
            if (!hasCorrectAnswer) {
              console.warn(`Failed to identify correct answer for question "${questionText}". The correct_answer value "${question.correct_answer}" doesn't match any of the answer_choices.`);
              // Still need a correct answer, so mark the first one
              if (answers.length > 0) {
                answers[0].isCorrect = true;
              }
            } else if (answers.filter(a => a.isCorrect).length > 1) {
              // If we marked multiple answers as correct due to fuzzy matching, keep only the best match
              console.warn(`Multiple correct answers identified for question "${questionText}". Will select the best match.`);
              
              // Find the best match (prioritize exact match, then normalized, then substring)
              const exactMatches = answers.filter(a => String(a.text).trim() === correctAnswerStr);
              if (exactMatches.length === 1) {
                // Reset all to false, then set only the exact match
                answers.forEach(a => a.isCorrect = false);
                exactMatches[0].isCorrect = true;
                console.log(`Selected exact match: "${exactMatches[0].text}"`);
              } else {
                // Just keep the first correct answer we found
                const firstCorrectIndex = answers.findIndex(a => a.isCorrect);
                answers.forEach((a, i) => a.isCorrect = i === firstCorrectIndex);
                console.log(`Selected first matching answer: "${answers[firstCorrectIndex].text}"`);
              }
            }
          }
          // If no correct_answer field, fall back to assuming the first answer is correct
          else {
            answers = question.answer_choices.map((choice: any, index: number) => ({
              text: String(choice),
              isCorrect: index === 0 // Assume first answer is correct if no correct_answer specified
            }));
            console.log(`Question "${questionText}" - assuming first answer is correct (no correct_answer field)`);
          }
        }
        // Case 3: Fallback to dummy answers
        else {
          answers = [
            { text: "Yes", isCorrect: true },
            { text: "No", isCorrect: false },
            { text: "Maybe", isCorrect: false },
          ];
          console.warn(`No valid answers found for question "${questionText}". Using dummy answers.`);
        }

        // Get category/topic and standardize it
        const category = question.topic || question.category || 'General Knowledge';
        const standardizedTopic = getStandardizedTopicName(category);
        
        // Get subtopic and branch (if available)
        const subtopic = question.subtopic || undefined;
        const branch = question.branch || undefined;
        
        // Get tags (if available)
        const tags = question.tags || [];
        
        // Get difficulty
        const difficulty = question.difficulty || 'Medium';
        
        // Get learning capsule/explanation
        const learningCapsule = question.learning_capsule || question.explanation || 'No additional information available for this question.';
        
        // Get background color based on category
        const backgroundColor = getTopicColor(category);

        return {
          id: question.id || String(Math.random()),
          topic: standardizedTopic,
          question: questionText,
          answers,
          difficulty,
          likes: Math.floor(Math.random() * 2000),  // Placeholder values
          views: Math.floor(Math.random() * 10000), // Placeholder values
          backgroundColor,
          learningCapsule,
          subtopic,
          branch,
          tags
        };
      });
    } catch (error) {
      console.error('Error during data retrieval:', error);
      return mockFeedData;
    }
  } catch (error) {
    console.error('Unexpected error while fetching trivia questions:', error);
    return mockFeedData;
  }
} 