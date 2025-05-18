import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabaseClient';
import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js'
// OpenAI API key should be stored securely
// Get the API key from multiple possible sources
let OPENAI_API_KEY = '';

// TEMPORARY DEVELOPMENT KEY FOR TESTING
// Replace with your actual key for dev testing only
// REMOVE BEFORE PRODUCTION!
const DEV_KEY = 'YOUR_API_KEY_HERE';

// Access environment variables based on the platform
try {
  // For Expo/React Native, use Constants
  if (Constants.expoConfig?.extra?.openaiApiKey) {
    OPENAI_API_KEY = Constants.expoConfig.extra.openaiApiKey;
  }
  // For web, access React environment variables (from .env.local)
  else if (typeof process !== 'undefined' && process.env && process.env.REACT_APP_OPENAI_KEY) {
    OPENAI_API_KEY = process.env.REACT_APP_OPENAI_KEY;
    console.log('[GENERATOR] Using web environment API key');
  }
  // Last resort for development - use the hardcoded key
  else if (process.env.NODE_ENV === 'development') {
    OPENAI_API_KEY = DEV_KEY;
    console.log('[GENERATOR] Using temporary hardcoded development key');
  }

  if (!OPENAI_API_KEY) {
    console.warn('[GENERATOR] No OpenAI API key found. Question generation will not work.');
  } else {
    console.log('[GENERATOR] OpenAI API Key configured successfully');
  }
} catch (error) {
  console.error('[GENERATOR] Error loading OpenAI API key:', error);
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    message: {
      role: string;
      content: string;
    };
    index: number;
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Trivia question format
export interface GeneratedQuestion {
  question: string;
  answers: {
    text: string;
    isCorrect: boolean;
  }[];
  category: string;
  subtopic: string;
  branch: string;
  difficulty: string;
  learningCapsule: string;
  tags: string[];
  tone?: string;
  format?: string;
  source?: string;
  created_at?: string;
  isDuplicate?: boolean; // Flag for marking duplicates when processing
}

/**
 * Call Edge Function to generate trivia questions
 */
export async function generateQuestions(
  primaryTopics: string[],
  adjacentTopics: string[],
  primaryCount: number = 6,
  adjacentCount: number = 6,
  preferredSubtopics: string[] = [],
  preferredBranches: string[] = [],
  preferredTags: string[] = [],
  recentQuestions: { id: string, questionText: string }[] = [],
  avoidIntentsSection: string = '' // Add parameter for topic-intent combinations to avoid
): Promise<GeneratedQuestion[]> {
  try {
    console.log('\n\n====================== OPENAI SERVICE LOGS ======================');
    console.log('[OPENAI] Starting question generation');
    console.log('[OPENAI] Input primary topics:', primaryTopics);
    console.log('[OPENAI] Input adjacent topics:', adjacentTopics);
    console.log('[OPENAI] Input preferred subtopics:', preferredSubtopics);
    console.log('[OPENAI] Input preferred branches:', preferredBranches);
    console.log('[OPENAI] Input preferred tags:', preferredTags);
    console.log('[OPENAI] Recent questions to avoid duplicating:', recentQuestions.length);
    console.log('[OPENAI] Has avoid intents section:', !!avoidIntentsSection);

    // Check if any topics have hierarchical format (topic:subtopic or topic:branch)
    const hasHierarchicalTopics = primaryTopics.some(topic => topic.includes(':'));
    if (hasHierarchicalTopics) {
      console.log('[OPENAI] DETECTED HIERARCHICAL TOPICS:',
        primaryTopics.filter(t => t.includes(':')));
    }

    // Process hierarchical topic formats (topic:subtopic, topic:branch)
    const processedPrimaryTopics: string[] = [];
    const explicitSubtopics: { topic: string, subtopic: string }[] = [];
    const explicitBranches: { topic: string, branch: string }[] = [];

    // Process any hierarchical format in primary topics
    primaryTopics.forEach(topic => {
      if (topic.includes(':')) {
        // Handle hierarchical format
        const [mainTopic, secondaryItem] = topic.split(':');
        console.log(`[OPENAI] Processing hierarchical topic: '${topic}' → main='${mainTopic}', secondary='${secondaryItem}'`);

        // Add the main topic to our processed list if not already there
        if (!processedPrimaryTopics.includes(mainTopic)) {
          processedPrimaryTopics.push(mainTopic);
          console.log(`[OPENAI] Added main topic: ${mainTopic}`);
        }

        // Determine if this is a subtopic or branch based on structure
        // If we can find it in preferredSubtopics, assume it's a subtopic
        if (preferredSubtopics.includes(secondaryItem)) {
          explicitSubtopics.push({ topic: mainTopic, subtopic: secondaryItem });
          console.log(`[OPENAI] Identified hierarchical topic:subtopic pair: ${mainTopic}:${secondaryItem}`);
        }
        // If we can find it in preferredBranches, assume it's a branch
        else if (preferredBranches.includes(secondaryItem)) {
          explicitBranches.push({ topic: mainTopic, branch: secondaryItem });
          console.log(`[OPENAI] Identified hierarchical topic:branch pair: ${mainTopic}:${secondaryItem}`);
        }
        // Otherwise, default to subtopic
        else {
          explicitSubtopics.push({ topic: mainTopic, subtopic: secondaryItem });
          console.log(`[OPENAI] Defaulting to topic:subtopic for unrecognized pair: ${mainTopic}:${secondaryItem}`);
        }
      } else {
        // Regular topic format, just add it
        processedPrimaryTopics.push(topic);
      }
    });

    // Log the processed hierarchical data
    console.log('[OPENAI] Input primary topics:', primaryTopics);
    console.log('[OPENAI] Processed primary topics:', processedPrimaryTopics);
    if (explicitSubtopics.length > 0) {
      console.log('[OPENAI] Explicit topic-subtopic pairs:',
        explicitSubtopics.map(item => `${item.topic}/${item.subtopic}`));
    }
    if (explicitBranches.length > 0) {
      console.log('[OPENAI] Explicit topic-branch pairs:',
        explicitBranches.map(item => `${item.topic}/${item.branch}`));
    }

    // Create a more dynamic prompt based on user preferences
    // Primary topics are intentionally ordered by priority - don't shuffle them
    const orderedPrimaryTopics = [...processedPrimaryTopics]; // Keep original order
    // Shuffle only the adjacent topics for variety
    const shuffledAdjacentTopics = [...adjacentTopics].sort(() => Math.random() - 0.5);

    // Create personalization sections for subtopics and branches if available
    // Add our explicit topic-subtopic mappings to the prompt
    let subtopicsSection = '';
    if (preferredSubtopics.length > 0 || explicitSubtopics.length > 0) {
      // Create a section that includes both standalone subtopics and explicit mappings
      const shuffledSubtopics = [...preferredSubtopics].sort(() => Math.random() - 0.5);

      // Create specialized section for explicit topic-subtopic pairs
      let explicitSubtopicSection = '';
      if (explicitSubtopics.length > 0) {
        explicitSubtopicSection = `
    IMPORTANT - DIRECT TOPIC-SUBTOPIC MAPPINGS (create at least ${Math.min(explicitSubtopics.length, 3)} questions using these exact pairs):
    ${explicitSubtopics.map(pair => `${pair.topic} → ${pair.subtopic}`).join('\n    ')}`;
      }

      // Regular subtopics section
      subtopicsSection = `
    PREFERRED SUBTOPICS (include at least 3 of these):
    ${shuffledSubtopics.join(', ')}${explicitSubtopicSection}`;
    }

    // Add our explicit topic-branch mappings to the prompt
    let branchesSection = '';
    if (preferredBranches.length > 0 || explicitBranches.length > 0) {
      // Create a section that includes both standalone branches and explicit mappings
      const shuffledBranches = [...preferredBranches].sort(() => Math.random() - 0.5);

      // Create specialized section for explicit topic-branch pairs
      let explicitBranchSection = '';
      if (explicitBranches.length > 0) {
        explicitBranchSection = `
    IMPORTANT - DIRECT TOPIC-BRANCH MAPPINGS (create at least ${Math.min(explicitBranches.length, 2)} questions using these exact pairs):
    ${explicitBranches.map(pair => `${pair.topic} → ${pair.branch}`).join('\n    ')}`;
      }

      // Regular branches section
      branchesSection = `
    PREFERRED BRANCHES (include at least 2 of these):
    ${shuffledBranches.join(', ')}${explicitBranchSection}`;
    }

    // Create personalization sections for the hierarchy: subtopics, branches, tags
    const top5Subtopics = preferredSubtopics.slice(0, 5);
    const top5Branches = preferredBranches.slice(0, 5);
    const top8Tags = preferredTags.slice(0, 8);

    let hierarchySection = '';
    if (top5Subtopics.length > 0 || top5Branches.length > 0 || top8Tags.length > 0 ||
      explicitSubtopics.length > 0 || explicitBranches.length > 0) {
      // Create a more detailed structure section based on what data we have
      const tagsSection = top8Tags.length > 0 ?
        `\n      * TAGS (IMPORTANT): Include at least 3-5 of these relevant tags per question: ${top8Tags.join(', ')}` :
        '';

      const subtopicsSection = top5Subtopics.length > 0 ?
        `\n      * SUBTOPICS: Use at least 2 of these specific subtopics: ${top5Subtopics.join(', ')}` :
        '';

      const branchesSection = top5Branches.length > 0 ?
        `\n      * BRANCHES: Use at least 2 of these specific branches: ${top5Branches.join(', ')}` :
        '';

      // Add explicit mapping instructions to the hierarchy section
      let explicitMappingsSection = '';
      if (explicitSubtopics.length > 0 || explicitBranches.length > 0) {
        explicitMappingsSection = `
    EXPLICIT HIERARCHICAL MAPPINGS (highest priority - MUST implement these exact relationships):
    ${explicitSubtopics.map(pair => `- Topic "${pair.topic}" MUST use subtopic "${pair.subtopic}" for at least 1 question`).join('\n    ')}
    ${explicitBranches.map(pair => `- Topic "${pair.topic}" MUST use branch "${pair.branch}" for at least 1 question`).join('\n    ')}`;
      }

      hierarchySection = `
    HIERARCHICAL STRUCTURE REQUIREMENTS:
    - For PRIMARY topics (${primaryCount} questions):${subtopicsSection}${branchesSection}${tagsSection}
      
    - For ADJACENT topics (${adjacentCount} questions):
      * Create appropriate subtopics that relate directly to the adjacent topics
      * Create appropriate branches that are specific subdivisions of those subtopics${tagsSection}
      
    Each question MUST follow this structure:
    1. A main TOPIC (from the list above)
    2. A specific SUBTOPIC (a specialized area within that topic)
    3. A precise BRANCH (a very specific sub-area of that subtopic)
    4. 3-5 relevant TAGS that directly relate to the question content
    
    This hierarchical structure ensures proper categorization and personalization.${explicitMappingsSection}`;
    }

    // Add section for recent questions
    let recentQuestionsSection = '';
    if (recentQuestions.length > 0) {
      // Take the 10 most recent questions to avoid prompt getting too long
      const limitedQuestions = recentQuestions.slice(0, 10);

      recentQuestionsSection = `
    RECENT QUESTIONS TO AVOID DUPLICATING:
    ${limitedQuestions.map((q, idx) => `${idx + 1}. \"${q.questionText}\"`).join('\n    ')}
    
    IMPORTANT: Do NOT generate questions that are similar to or duplicates of these recent questions.
    `;
    }

    // Build a more personalized prompt with specific instructions
    const prompt = `Generate 12 unique trivia questions for a trivia app, with detailed personalization:

    DISTRIBUTION AND STRUCTURE:
    - 6 questions about primary user interest topics: ${orderedPrimaryTopics.join(', ')}
      NOTE: The topics are listed in ORDER OF PRIORITY. Strongly favor the FIRST 3 topics in this list.
      At least 4 questions MUST be about these first 3 topics.
      
    - 6 questions about adjacent topics for exploration: ${shuffledAdjacentTopics.join(', ')}
      These are for variety and exploring related interests.

    CRITICAL DUPLICATION RULES:
    - Within this single response, do NOT create multiple questions about the same:
      * Person/artist/historical figure (e.g., don't ask two different questions about Michael Jackson)
      * Work/album/book/movie (e.g., don't ask about both sales and content of "Thriller")
      * Event/phenomenon (e.g., don't ask two questions about the same historical event)
      * Concept (e.g., don't ask multiple questions testing the same knowledge point)
    - Each question must be entirely distinct in subject matter from all others in this batch
    - Create maximum variety in questions, even within the same topic
 
    CRITICAL DUPLICATION PREVENTION:
    1. SUBJECT-INTENT UNIQUENESS:
       - When asking about a specific entity (person, place, thing), only ask ONE question about each specific property
       - Example: If asking about Amazon Rainforest's size, don't also ask about its area or extent
       - Example: If asking about Amazon Rainforest's biodiversity, don't also ask about species count or variety

    2. FINGERPRINT PATTERNS TO AVOID:
       - Don't create questions that follow these patterns for the same entity:
         * "What is the [adjective] [feature] of [entity]?" + "Which [entity] is known for [same feature]?"
         * "Where is [entity] located?" + "In which [location] can [entity] be found?"
         * "When was [event] that happened at [entity]?" + "What year did [same event] occur at [entity]?"

    3. ANSWER-BASED DIVERSIFICATION:
       - BEFORE adding a question to the final set, check if any other question in this batch has the same answer
       - If two questions would have the same answer, ensure they're asking about COMPLETELY different aspects
       - Example: If "What rainforest has the most biodiversity?" and "Which ecosystem contains the largest variety of plant species?" both have "Amazon Rainforest" as the answer, only keep one
    ${avoidIntentsSection}
    ${hierarchySection}
    ${subtopicsSection}
    ${branchesSection}
    ${recentQuestionsSection}

    For EACH question, include:
    1. A main topic (e.g., "Science", "History", "Geography") - choose from the provided topics
    2. A specific subtopic that represents a specialized area of the main topic
    3. A precise branch that represents a very specific sub-area within the subtopic
    4. 3-5 specific, descriptive tags related to the question content
    5. Four answer choices with only one correct
    6. Difficulty level (easy, medium, hard)
    7. A "learning capsule" providing interesting additional context about the answer
    8. The tone ("educational", "fun", "challenging", "neutral")
    9. Format ("multiple_choice")

    IMPORTANT: Make the categorization HIGHLY SPECIFIC and HIERARCHICAL (topic → subtopic → branch).
    For example, instead of "Science" → "Biology" → "Animals", use "Science" → "Zoology" → "Endangered Species Conservation".
    Make tags very specific to the question content (e.g. "Alpine glaciers", "preservation techniques", "habitat restoration").
    
    DO NOT generate obvious or basic questions that test common knowledge. Instead, create thought-provoking questions that:
    - Reveal surprising or lesser-known facts
    - Connect concepts in unexpected ways
    - Challenge users with interesting specifics rather than general trivia
    - Focus on intriguing details rather than basic definitions
    
    Ensure a mix of difficulty levels across the questions.
    For primary topics, match user preferences by creating questions that explore different subtopics and branches within those main topics.
    For adjacent topics, create questions that might expand the user's interests related to their primary topics.
    
    IMPORTANT: Respond ONLY with a valid JSON array containing the question objects.
    DO NOT include any text before or after the JSON array.
    DO NOT include numbered points or markdown formatting.
    DO NOT include any explanations before or after the JSON array.
    ONLY return a JSON array in this exact format:
    [
      {
        "question": "Detailed question text?",
        "answers": [
          {"text": "Correct answer", "isCorrect": true},
          {"text": "Wrong answer 1", "isCorrect": false},
          {"text": "Wrong answer 2", "isCorrect": false},
          {"text": "Wrong answer 3", "isCorrect": false}
        ],
        "category": "Main Topic",
        "subtopic": "Specific Subtopic",
        "branch": "Precise Branch",
        "difficulty": "easy|medium|hard",
        "learningCapsule": "Fascinating fact about the answer that provides additional context",
        "tags": ["specific_tag1", "specific_tag2", "specific_tag3", "specific_tag4"],
        "tone": "educational|fun|challenging|neutral",
        "format": "multiple_choice"
      },
      // more questions...
    ]
    
    Ensure all questions are factually accurate and represented as valid JSON.`;

    // Log important sections of the prompt
    console.log('[OPENAI] Primary topics in prompt:', orderedPrimaryTopics);
    console.log('[OPENAI] Explicit mappings in prompt:');
    if (explicitSubtopics.length > 0) {
      console.log('  Topic-Subtopic pairs:');
      explicitSubtopics.forEach(pair => {
        console.log(`    ${pair.topic} → ${pair.subtopic}`);
      });
    }
    if (explicitBranches.length > 0) {
      console.log('  Topic-Branch pairs:');
      explicitBranches.forEach(pair => {
        console.log(`    ${pair.topic} → ${pair.branch}`);
      });
    }

    // For debugging - show critical sections of the prompt
    if (explicitSubtopics.length > 0 || explicitBranches.length > 0) {
      console.log('[OPENAI] Hierarchical section in prompt:');
      const section = hierarchySection ? hierarchySection.split('\n').slice(0, 10).join('\n') : 'None';
      console.log(section);
    }

    console.log(`[OPENAI] Final prompt sections (first 3 lines of each):`);
    console.log(`DISTRIBUTION:\n${prompt.split('\n').slice(2, 5).join('\n')}`);
    console.log(`HIERARCHY:\n${hierarchySection ? hierarchySection.split('\n').slice(0, 3).join('\n') : 'None'}`);
    console.log(`SUBTOPICS:\n${subtopicsSection ? subtopicsSection.split('\n').slice(0, 3).join('\n') : 'None'}`);
    console.log(`BRANCHES:\n${branchesSection ? branchesSection.split('\n').slice(0, 3).join('\n') : 'None'}`);
    console.log(`RECENT QUESTIONS:\n${recentQuestionsSection ? recentQuestionsSection.split('\n').slice(0, 3).join('\n') : 'None'}`);

    console.log('====================== END OPENAI SERVICE LOGS ======================\n\n');
    const model = 'gpt-4o-mini'; // Make this easier to change if needed
    console.log('[GENERATOR] Making request to edge function');

    // Get Supabase credentials from environment variables or Constants
    let SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
    let SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

    // Fallback to Constants.expoConfig if env vars are not available
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      if (Constants.expoConfig?.extra?.supabaseUrl) {
        SUPABASE_URL = Constants.expoConfig.extra.supabaseUrl;
      }
      if (Constants.expoConfig?.extra?.supabaseAnonKey) {
        SUPABASE_KEY = Constants.expoConfig.extra.supabaseAnonKey;
      }
    }

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      console.error('[GENERATOR] Missing Supabase credentials. Check environment variables or app.config.js');
      throw new Error('Missing Supabase credentials');
    }

    console.log('[GENERATOR] Using Supabase URL:', SUPABASE_URL);
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    try {
      console.log('\n\n====================== OPENAI SERVICE LOGS ======================');
      console.log('[OPENAI] Starting question generation');
      console.log('[OPENAI] Input primary topics:', primaryTopics);

      const { data, error } = await supabase.functions.invoke('generateTriviaQuestions', {
        body: {
          model,
          messages: [
            {
              role: 'system',
              content: 'You are a specialized trivia question generator that creates high-quality, factually accurate questions with detailed categorization for a trivia app. You must ONLY respond with a valid JSON array without any additional text, formatting, or explanations.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.8,
          max_tokens: 4000
        }
      });

      console.log('[GENERATOR] Full response:', {
        hasData: !!data,
        dataType: typeof data,
        dataKeys: data ? Object.keys(data) : [],
        error: error
      });

      if (error) {
        console.error('[GENERATOR] Edge function error:', error);
        throw new Error(`Edge function error: ${error.message}`);
      }

      // Parse the response data if it's a string
      let parsedData;
      try {
        parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        console.log('[GENERATOR] Parsed response data:', {
          type: typeof parsedData,
          hasChoices: !!parsedData?.choices,
          choicesLength: parsedData?.choices?.length
        });
      } catch (parseError) {
        console.error('[GENERATOR] Error parsing response data:', parseError);
        console.error('[GENERATOR] Raw data:', data);
        throw new Error('Failed to parse response from Edge Function');
      }

      // Extract content from the chat completion response
      const content = parsedData?.choices?.[0]?.message?.content;
      if (!content) {
        console.error('[GENERATOR] Response data structure:', {
          parsedData,
          choices: parsedData?.choices,
          firstChoice: parsedData?.choices?.[0],
          message: parsedData?.choices?.[0]?.message
        });
        throw new Error('Missing content in OpenAI response');
      }

      try {
        // Parse the content as JSON
        const questions = JSON.parse(content) as GeneratedQuestion[];
        console.log('[GENERATOR] Successfully parsed questions:', questions.length);
        
        // Validate the questions array
        if (!Array.isArray(questions)) {
          throw new Error('Response is not an array of questions');
        }

        // Add metadata to each question
        return questions.map(q => ({
          ...q,
          source: 'generated',
          created_at: new Date().toISOString()
        }));
      } catch (parseError) {
        console.error('[GENERATOR] Error parsing questions:', parseError);
        console.error('[GENERATOR] Raw content:', content);
        throw new Error('Failed to parse questions from response');
      }

    } catch (e) {
      console.error('[OPENAI SERVICE] Error generating questions:', e);
      throw e;
    }
  } catch (error) {
    console.error('[GENERATOR] Error during question generation:', error);
    throw error;
  }
}

/**
 * Generate a fingerprint for a question to detect duplicates
 */
export function generateQuestionFingerprint(question: string, tags: string[]): string {
  // Normalize the question text: lowercase, remove punctuation, extra spaces
  const normalizedQuestion = question
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Sort and join tags
  const normalizedTags = [...tags].sort().join('|').toLowerCase();

  // Create a simple hash by combining normalized text
  return `${normalizedQuestion}|${normalizedTags}`;
}

/**
 * Generate an enhanced fingerprint that includes intent and entity recognition
 * This provides more accurate duplicate detection by understanding question meaning
 */
export function generateEnhancedFingerprint(question: string, tags: string[] = []): string {
  // Extract the basic intent of the question (what, where, when, who, how many)
  const intent = extractQuestionIntent(question);
  
  // Extract named entities from the question
  const entities = extractNamedEntities(question);
  
  // Normalize the question text as in the original function
  const normalizedQuestion = question
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Sort and join tags
  const normalizedTags = [...tags].sort().join('|').toLowerCase();
  
  // Create enhanced fingerprint with intent and entities
  return `${intent}|${entities.join('|')}|${normalizedQuestion}|${normalizedTags}`;
}

/**
 * Extract the primary intent of a question
 */
function extractQuestionIntent(question: string): string {
  if (!question) return 'unknown';
  
  const text = question.toLowerCase();
  
  // Questions asking for dates/years
  if ((text.includes('year') || text.includes('date') || text.includes('when')) && 
       /\b(occur|happened|established|founded|created|built|launched|released|started)\b/.test(text)) {
    return 'temporal';
  }
  
  // Questions asking for places/locations
  if ((text.includes('where') || text.includes('location') || text.includes('place')) ||
      (text.includes('which') && 
       (text.includes('country') || text.includes('city') || text.includes('continent') || 
        text.includes('region') || text.includes('located')))) {
    return 'spatial';
  }
  
  // Questions asking about people
  if (text.includes('who') || 
      (text.includes('which') && (text.includes('person') || text.includes('individual') || 
                                 text.includes('actor') || text.includes('actress') || 
                                 text.includes('scientist') || text.includes('artist')))) {
    return 'person';
  }
  
  // Questions asking for quantities or measurements
  if ((text.includes('how many') || text.includes('how much')) || 
      (text.includes('number of') || text.includes('amount of') || 
       text.includes('percentage') || text.includes('proportion'))) {
    return 'quantitative';
  }
  
  // Known-for pattern detection
  if (/\b(known|famous|recognized|remembered|celebrated)\s+(for|as)\b/.test(text)) {
    return 'attribute';
  }
  
  // Questions about works/creations
  if (/\b(paint|wrote|directed|composed|created|designed|built|constructed)\b/.test(text)) {
    return 'creation';
  }
  
  // Default to a generic intent based on the first question word
  if (text.includes('what')) return 'definition';
  if (text.includes('which')) return 'selection';
  if (text.includes('why')) return 'causation';
  if (text.includes('how')) return 'process';
  
  return 'unknown';
}

/**
 * Extract named entities from question text
 */
function extractNamedEntities(text: string): string[] {
  if (!text) return [];
  
  const entities: string[] = [];
  
  // Simple named entity extraction using capitalization
  const words = text.split(/\s+/);
  let currentEntity: string[] = [];
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    // Skip first word of sentence and common words even if capitalized
    const isFirstWord = i === 0 || words[i-1].match(/[.!?]$/);
    const isCommonWord = /^(The|A|An|In|On|Of|For|And|But|Or|Not|Is|Are|Was|Were|Be|Been|Being)$/i.test(word);
    
    if (word.match(/^[A-Z][a-z]+/) && !isFirstWord && !isCommonWord) {
      currentEntity.push(word);
    } else if (currentEntity.length > 0) {
      entities.push(currentEntity.join(' ').toLowerCase());
      currentEntity = [];
    }
  }
  
  // Add any remaining entity
  if (currentEntity.length > 0) {
    entities.push(currentEntity.join(' ').toLowerCase());
  }
  
  // Also extract quoted entities
  const quoteRegex = /'([^']+)'|"([^"]+)"|'([^']+)'|"([^"]+)"/g;
  let match;
  
  while ((match = quoteRegex.exec(text)) !== null) {
    const entity = match[1] || match[2] || match[3] || match[4];
    if (entity && entity.length > 2) {
      entities.push(entity.toLowerCase());
    }
  }
  
  return [...new Set(entities)]; // Remove duplicates
}

/**
 * Calculate similarity between two fingerprints
 */
export function calculateFingerprintSimilarity(fp1: string, fp2: string): number {
  if (!fp1 || !fp2) return 0;
  
  // Split fingerprints into their components
  const [intent1, entities1, question1, tags1] = fp1.split('|', 4);
  const [intent2, entities2, question2, tags2] = fp2.split('|', 4);
  
  // Calculate intent similarity (same/different)
  const intentSimilarity = intent1 === intent2 ? 1.0 : 0.0;
  
  // Calculate entity similarity
  let entitySimilarity = 0;
  if (entities1 && entities2) {
    const entitiesArr1 = entities1.split('|');
    const entitiesArr2 = entities2.split('|');
    
    // Find common entities
    const commonEntities = entitiesArr1.filter(e => entitiesArr2.includes(e));
    entitySimilarity = commonEntities.length / Math.max(entitiesArr1.length, entitiesArr2.length) || 0;
  }
  
  // Calculate question text similarity using our string similarity function
  const textSimilarity = question1 && question2 ? calculateLevenshteinSimilarity(question1, question2) : 0;
  
  // Calculate tag similarity
  let tagSimilarity = 0;
  if (tags1 && tags2) {
    const tagsArr1 = tags1.split('|');
    const tagsArr2 = tags2.split('|');
    
    // Find common tags
    const commonTags = tagsArr1.filter(t => tagsArr2.includes(t));
    tagSimilarity = commonTags.length / Math.max(tagsArr1.length, tagsArr2.length) || 0;
  }
  
  // Weight the different components
  return (
    0.5 * textSimilarity +    // Text similarity matters most
    0.3 * entitySimilarity +  // Entities matter second most
    0.1 * intentSimilarity +  // Intent similarity
    0.1 * tagSimilarity       // Tags matter least
  );
}

/**
 * Helper function for calculating Levenshtein-based string similarity
 * (Wrapper around the existing calculateStringSimilarity function)
 */
function calculateLevenshteinSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  
  // Normalize strings
  const a = str1.toLowerCase().trim();
  const b = str2.toLowerCase().trim();
  
  // Quick check for exact match
  if (a === b) return 1;
  
  // Calculate Levenshtein distance
  const matrix = [];
  
  // Increment along the first column of each row
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  
  // Increment each column in the first row
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i-1) === a.charAt(j-1)) {
        matrix[i][j] = matrix[i-1][j-1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i-1][j-1] + 1, // substitution
          matrix[i][j-1] + 1,   // insertion
          matrix[i-1][j] + 1    // deletion
        );
      }
    }
  }
  
  // Convert distance to similarity score between 0 and 1
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1; // Both strings are empty
  
  return 1 - matrix[b.length][a.length] / maxLen;
}

/**
 * Check if a question already exists in the database
 */
export async function checkQuestionExists(fingerprint: string): Promise<boolean> {
  try {
    // First try to check by fingerprint for exact matches
    const { data: fingerprintData, error: fingerprintError } = await supabase
      .from('trivia_questions')
      .select('id')
      .eq('fingerprint', fingerprint)
      .limit(1);

    if (fingerprintError) {
      console.error('Error checking fingerprint existence:', fingerprintError);

      // If the column doesn't exist yet, this will fall back to question_text check
      if (fingerprintError.message.includes('column "fingerprint" does not exist')) {
        console.log('[GENERATOR] Fingerprint column not found, falling back to question text comparison');
        return fallbackQuestionCheck(fingerprint);
      }

      throw fingerprintError;
    }

    // If we found a match by fingerprint
    if (fingerprintData && fingerprintData.length > 0) {
      console.log('[GENERATOR] Found existing question with matching fingerprint');
      return true;
    }

    // If no exact fingerprint match, do a similarity check
    return checkQuestionSimilarity(fingerprint);
  } catch (error) {
    console.error('Error checking question existence:', error);
    return false; // Assume question doesn't exist if there's an error
  }
}

/**
 * Check if a question is similar to any existing questions
 * Considers questions with 1-3 word differences as duplicates
 */
async function checkQuestionSimilarity(fingerprint: string): Promise<boolean> {
  try {
    // Extract just the question part from the fingerprint (before the first |)
    const normalizedQuestion = fingerprint.split('|')[0];
    const questionWords = new Set(normalizedQuestion.split(' '));

    // Get all questions to check for similarity
    const { data: questions, error } = await supabase
      .from('trivia_questions')
      .select('id, question_text, fingerprint');

    if (error) {
      console.error('Error in similarity check:', error);
      return false;
    }

    // If we have results, check each one for similarity
    if (questions && questions.length > 0) {
      console.log(`[GENERATOR] Checking similarity against ${questions.length} questions...`);

      for (const question of questions) {
        if (!question.question_text) continue;

        // Get the normalized question text from the fingerprint or normalize it
        let storedNormalized: string;
        if (question.fingerprint) {
          storedNormalized = question.fingerprint.split('|')[0];
        } else {
          storedNormalized = question.question_text
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        }

        // Get words from stored question
        const storedWords = new Set(storedNormalized.split(' '));

        // Calculate word differences
        const uniqueToNew = [...questionWords].filter(word => !storedWords.has(word));
        const uniqueToStored = [...storedWords].filter(word => !questionWords.has(word));

        // If total word differences is 3 or less, consider it a duplicate
        if (uniqueToNew.length + uniqueToStored.length <= 3) {
          console.log('[GENERATOR] Found similar existing question:');
          console.log('  New:     ', normalizedQuestion);
          console.log('  Existing:', storedNormalized);
          console.log('  Diff words:', [...uniqueToNew, ...uniqueToStored].join(', '));
          return true;
        }
        
        // ENHANCEMENT: Add semantic similarity check using enhanced fingerprints
        try {
          // Generate enhanced fingerprints for better comparison
          const enhancedFingerprintNew = generateEnhancedFingerprint(normalizedQuestion);
          const enhancedFingerprintStored = generateEnhancedFingerprint(question.question_text);
          
          // Calculate semantic similarity between the fingerprints
          const semanticSimilarity = calculateFingerprintSimilarity(
            enhancedFingerprintNew,
            enhancedFingerprintStored
          );
          
          // If the semantic similarity is high, consider it a duplicate
          if (semanticSimilarity > 0.75) {
            console.log('[GENERATOR] Found semantically similar question:');
            console.log('  New:     ', normalizedQuestion);
            console.log('  Existing:', storedNormalized);
            console.log('  Semantic similarity:', semanticSimilarity.toFixed(2));
            return true;
          }
        } catch (semanticError) {
          // If semantic check fails, fall back to word-based comparison only
          console.warn('[GENERATOR] Semantic similarity check failed, using only word-based comparison');
        }
      }
    }

    return false; // No similar questions found
  } catch (error) {
    console.error('Error in similarity check:', error);
    return false;
  }
}

/**
 * Fallback check for question existence using normalized text
 * This is used when fingerprint column isn't available or as a secondary check
 */
async function fallbackQuestionCheck(fingerprint: string): Promise<boolean> {
  try {
    // Extract just the question part from the fingerprint (before the first |)
    const normalizedQuestion = fingerprint.split('|')[0];

    // Check for similar questions by normalized text
    const { data, error } = await supabase
      .from('trivia_questions')
      .select('id, question_text')
      .limit(10); // Get a few questions to compare

    if (error) {
      console.error('Error in fallback question check:', error);
      return false;
    }

    // If we have results, check each one for similarity
    if (data && data.length > 0) {
      // For each question, normalize it and compare
      for (const question of data) {
        if (!question.question_text) continue;

        // Normalize the stored question the same way we normalize the fingerprint
        const storedNormalized = question.question_text
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        // If the normalized texts match closely
        if (storedNormalized === normalizedQuestion ||
          storedNormalized.includes(normalizedQuestion) ||
          normalizedQuestion.includes(storedNormalized)) {
          console.log('[GENERATOR] Found similar existing question in fallback check');
          return true;
        }
      }
    }

    return false; // No similar questions found
  } catch (error) {
    console.error('Error in fallback question check:', error);
    return false;
  }
} 