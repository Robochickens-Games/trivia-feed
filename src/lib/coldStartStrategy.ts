import { FeedItem } from './triviaService';
import { UserProfile } from './personalizationService';
import { ALL_TOPICS, INITIAL_EXPLORATION_TOPICS, getDefaultTopicWeights } from '../constants/topics';

// Define types for categorizing questions
type Topic = string;
type Subtopic = string;
type Branch = string;

// Default weight threshold that separates preferred topics from exploration topics
const PREFERRED_TOPIC_THRESHOLD = 0.5;

// Maximum number of consecutive questions allowed from the same topic
const MAX_CONSECUTIVE_TOPIC = 2;

// Track question selection for the cold start phases
interface ColdStartState {
  phase: 'exploration' | 'branching' | 'normal'; // Three phases: Exploration (1-5), Branching (6-20), Normal (20+)
  questionsShown: number;                       // Total questions shown to the user
  topicsShown: Set<string>;                     // Topic names already shown
  shownQuestionIds: Set<string>;                // Question IDs that have been shown already
  subtopicsShown: Map<Topic, Set<Subtopic>>;    // Subtopics shown by topic
  recentTopics: string[];                       // Recently shown topics (for diversity mechanism)
  correctAnsweredByTopic: Map<Topic, number>;   // Number of correctly answered questions by topic
  wrongAnsweredByTopic: Map<Topic, number>;     // Number of incorrectly answered questions by topic
  skippedByTopic: Map<Topic, number>;           // Number of skipped questions by topic
  previouslyInterestedTopics: string[];         // Topics the user previously answered (right or wrong)
  isExplorationQuestion: Set<string>;           // Question IDs that were presented as exploration questions
  topicWeights: Map<Topic, number>;             // In-session topic weights
  topicCountInCurrentBatch: Map<Topic, number>; // Count of each topic in the current batch (for diversity)
  lastSelectedTopics: string[];                 // Last N topics selected (for limiting consecutive selections)
}

// Initialize cold start state
function initColdStartState(): ColdStartState {
  return {
    phase: 'exploration',
    questionsShown: 0,
    topicsShown: new Set(),
    shownQuestionIds: new Set(),
    subtopicsShown: new Map(),
    recentTopics: [],
    correctAnsweredByTopic: new Map(),
    wrongAnsweredByTopic: new Map(),
    skippedByTopic: new Map(),
    previouslyInterestedTopics: [],
    isExplorationQuestion: new Set(),
    topicWeights: new Map(),
    topicCountInCurrentBatch: new Map(),
    lastSelectedTopics: []
  };
}

// Group questions by topic and subtopic
function groupQuestionsByTopic(allQuestions: FeedItem[]): Map<Topic, Map<Subtopic, FeedItem[]>> {
  const groupedQuestions = new Map<Topic, Map<Subtopic, FeedItem[]>>();

  allQuestions.forEach(question => {
    const topic = question.topic;
    const subtopic = question.tags?.[0] || 'General';
    
    if (!groupedQuestions.has(topic)) {
      groupedQuestions.set(topic, new Map<Subtopic, FeedItem[]>());
    }
    
    const topicMap = groupedQuestions.get(topic)!;
    
    if (!topicMap.has(subtopic)) {
      topicMap.set(subtopic, []);
    }
    
    topicMap.get(subtopic)!.push(question);
  });

  return groupedQuestions;
}

// Helper function to check if a topic is allowed based on diversity requirements
function isTopicAllowedForDiversity(state: ColdStartState, topic: string): boolean {
  // Check if this would be the third consecutive question from the same topic
  if (state.lastSelectedTopics.length >= MAX_CONSECUTIVE_TOPIC) {
    const recentTopics = state.lastSelectedTopics.slice(0, MAX_CONSECUTIVE_TOPIC);
    if (recentTopics.every(t => t === topic)) {
      console.log(`Topic ${topic} rejected: would be ${MAX_CONSECUTIVE_TOPIC + 1} consecutive questions from same topic`);
      return false;
    }
  }
  
  // Check if this topic appears too frequently in recent history
  // For branching phase, we want to strongly discourage repeated topics
  if (state.phase === 'branching') {
    const topicOccurrences = state.lastSelectedTopics.filter(t => t === topic).length;
    if (topicOccurrences >= 1) {
      console.log(`Topic ${topic} rejected in branching phase: already used ${topicOccurrences} times recently`);
      return false;
    }
  }
  
  // Additional check for normal phase to ensure better topic distribution
  if (state.phase === 'normal') {
    // Get the count of this topic in the current batch
    const topicCount = state.topicCountInCurrentBatch.get(topic) || 0;
    
    // Get the total count of all topics
    const totalCount = Array.from(state.topicCountInCurrentBatch.values()).reduce((sum, count) => sum + count, 0);
    
    // If we have at least 4 questions and this topic is already overrepresented, reject
    if (totalCount >= 4) {
      const expectedProportion = 1 / (state.topicCountInCurrentBatch.size || 1);
      const actualProportion = topicCount / totalCount;
      
      if (actualProportion >= expectedProportion * 2) {
        console.log(`Topic ${topic} rejected in normal phase: already overrepresented (${topicCount}/${totalCount} questions, ${(actualProportion * 100).toFixed(1)}%)`);
        return false;
      }
    }
  }
  
  return true;
}

// Helper function to update diversity trackers when a question is selected
function trackTopicForDiversity(state: ColdStartState, topic: string): void {
  // Update last selected topics
  state.lastSelectedTopics.unshift(topic);
  if (state.lastSelectedTopics.length > MAX_CONSECUTIVE_TOPIC * 2) {
    state.lastSelectedTopics.pop();
  }
  
  // Update count in current batch
  const currentCount = state.topicCountInCurrentBatch.get(topic) || 0;
  state.topicCountInCurrentBatch.set(topic, currentCount + 1);
  
  console.log(`Topic diversity tracking updated: ${topic} now has count ${currentCount + 1}, last topics: [${state.lastSelectedTopics.join(', ')}]`);
}

// Get questions for the exploration phase (1-5)
function getExplorationPhaseQuestions(
  allQuestions: FeedItem[],
  groupedQuestions: Map<Topic, Map<Subtopic, FeedItem[]>>,
  state: ColdStartState,
  userProfile: UserProfile
): FeedItem[] {
  console.log("Getting Initial Exploration phase questions (1-5) - STRICT ONE PER TOPIC");
  
  // Initialize topic weights from userProfile
  initializeTopicWeights(state, userProfile, Array.from(groupedQuestions.keys()));

  const selectedQuestions: FeedItem[] = [];
  const selectedTopics = new Set<string>(); // Track selected topics to ensure diversity
  
  // Clear the topic count for this new batch
  state.topicCountInCurrentBatch.clear();
  
  // Create a prioritized list of initial topics to try
  // We want to try all initial topics first
  const prioritizedTopics = [...INITIAL_EXPLORATION_TOPICS];
  
  // Shuffle to get some randomness in selection order, while maintaining the priority of initial topics
  shuffleArray(prioritizedTopics);
  
  console.log(`Prioritized initial topics (after shuffle): ${prioritizedTopics.join(', ')}`);
  
  // First pass: Try to select one question from each initial topic
  for (const topic of prioritizedTopics) {
    // Skip if we already have 5 questions
    if (selectedQuestions.length >= 5) break;
    
    // Skip if we already selected a question from this topic
    if (selectedTopics.has(topic)) {
      console.log(`Skipping topic ${topic} - already selected a question from this topic`);
      continue;
    }
    
    const topicMap = groupedQuestions.get(topic);
    if (!topicMap) {
      console.log(`Topic ${topic} has no questions available in groupedQuestions`);
      continue;
    }
    
    // Get all questions from this topic that haven't been shown
    const availableQuestions = Array.from(topicMap.values()).flat()
      .filter(q => !state.shownQuestionIds.has(q.id));
      
    console.log(`Topic ${topic} has ${availableQuestions.length} available questions`);
      
    if (availableQuestions.length > 0) {
      // Randomly select a question from this topic
      const question = availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
      selectedQuestions.push(question);
      
      // Track that we've used this topic
      selectedTopics.add(topic);
      
      // Mark as shown and as an exploration question
      state.shownQuestionIds.add(question.id);
      state.topicsShown.add(topic);
      state.isExplorationQuestion.add(question.id);
      
      // Track this topic for diversity
      trackTopicForDiversity(state, topic);
      
      console.log(`Added question from initial topic: ${topic} (weight: ${state.topicWeights.get(topic)?.toFixed(2) || 'default'})`);
      
      // Add to recent topics for diversity tracking
      state.recentTopics.unshift(topic);
      if (state.recentTopics.length > 5) {
        state.recentTopics.pop();
      }
    } else {
      console.log(`No unseen questions available for topic ${topic}`);
    }
  }

  // If we still don't have 5 questions, try the initial topics again (allow duplicates if necessary)
  if (selectedQuestions.length < 5) {
    console.log(`Only selected ${selectedQuestions.length} questions from initial topics, need ${5 - selectedQuestions.length} more`);
    
    // Make a new copy of initial topics and shuffle again for a different order
    const remainingInitialTopics = [...INITIAL_EXPLORATION_TOPICS];
    shuffleArray(remainingInitialTopics);
    
    console.log(`Trying initial topics again: ${remainingInitialTopics.join(', ')}`);
    
    // Try each initial topic again, even if we've already used it
    for (const topic of remainingInitialTopics) {
      if (selectedQuestions.length >= 5) break;
      
      const topicMap = groupedQuestions.get(topic);
      if (!topicMap) continue;
      
      // Get available questions that haven't been shown yet
      const availableQuestions = Array.from(topicMap.values()).flat()
        .filter(q => !state.shownQuestionIds.has(q.id));
        
      if (availableQuestions.length > 0) {
        // Randomly select a question
        const question = availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
        selectedQuestions.push(question);
        
        // Track that we've used this topic
        selectedTopics.add(topic);
        
        // Mark as shown and as an exploration question
        state.shownQuestionIds.add(question.id);
        state.topicsShown.add(topic);
        state.isExplorationQuestion.add(question.id);
        
        // Track this topic for diversity
        trackTopicForDiversity(state, topic);
        
        console.log(`Added additional question from initial topic: ${topic}`);
        
        // Add to recent topics for diversity tracking
        state.recentTopics.unshift(topic);
        if (state.recentTopics.length > 5) {
          state.recentTopics.pop();
        }
      }
    }
  }
  
  // Last resort: If we still need more questions, use any remaining questions FROM INITIAL TOPICS ONLY
  if (selectedQuestions.length < 5) {
    console.log(`Still only have ${selectedQuestions.length} questions, need ${5 - selectedQuestions.length} more from INITIAL TOPICS ONLY`);
    
    // Get unused initial topics first - this is the key improvement
    const unusedInitialTopics = INITIAL_EXPLORATION_TOPICS.filter(topic => 
      !Array.from(state.topicsShown).includes(topic) && 
      !selectedQuestions.some(q => q.topic === topic)
    );
    
    console.log(`Prioritizing unused initial topics: ${unusedInitialTopics.join(', ')}`);
    
    // Filter questions to prioritize unused topics
    const remainingQuestionsFromUnusedTopics = allQuestions
      .filter(q => !state.shownQuestionIds.has(q.id))
      .filter(q => !selectedQuestions.some(sq => sq.id === q.id))
      .filter(q => unusedInitialTopics.includes(q.topic));
      
    // If we still need more, fall back to any initial topic
    const remainingQuestionsFromAnyInitialTopic = allQuestions
      .filter(q => !state.shownQuestionIds.has(q.id))
      .filter(q => !selectedQuestions.some(sq => sq.id === q.id))
      .filter(q => INITIAL_EXPLORATION_TOPICS.includes(q.topic))
      .filter(q => !remainingQuestionsFromUnusedTopics.some(uq => uq.id === q.id));
    
    // Combine with priority for unused topics
    const remainingQuestionsFromUnusedTopicsCopy = [...remainingQuestionsFromUnusedTopics];
    const remainingQuestionsFromAnyInitialTopicCopy = [...remainingQuestionsFromAnyInitialTopic];
    
    shuffleArray(remainingQuestionsFromUnusedTopicsCopy);
    shuffleArray(remainingQuestionsFromAnyInitialTopicCopy);
    
    const remainingQuestions = [
      ...remainingQuestionsFromUnusedTopicsCopy, 
      ...remainingQuestionsFromAnyInitialTopicCopy
    ];
    
    console.log(`Found ${remainingQuestionsFromUnusedTopics.length} questions from unused topics and ${remainingQuestionsFromAnyInitialTopic.length} from previously used topics`);
    
    // Add questions up to 5 total
    for (const question of remainingQuestions) {
      if (selectedQuestions.length >= 5) break;
      
      selectedQuestions.push(question);
      
      // Mark as shown and as an exploration question
      state.shownQuestionIds.add(question.id);
      state.topicsShown.add(question.topic);
      state.isExplorationQuestion.add(question.id);
      
      // Track this topic for diversity
      trackTopicForDiversity(state, question.topic);
      
      console.log(`Added question from last-resort (initial topics only): ${question.topic}`);
      
      // Add to recent topics for diversity tracking
      state.recentTopics.unshift(question.topic);
      if (state.recentTopics.length > 5) {
        state.recentTopics.pop();
      }
    }
  }
  
  console.log(`Selected ${selectedQuestions.length} exploration questions from ${selectedTopics.size} different topics`);
  console.log(`Topics used: ${Array.from(selectedTopics).join(', ')}`);
  console.log(`Topics now shown: ${Array.from(state.topicsShown).join(', ')}`);
  console.log(`Topic distribution: ${Array.from(state.topicCountInCurrentBatch.entries()).map(([topic, count]) => `${topic}: ${count}`).join(', ')}`);

  return selectedQuestions;
}

// Initialize topic weights from userProfile
function initializeTopicWeights(state: ColdStartState, userProfile: UserProfile, allTopics: string[]): void {
  // Add any topics from the user profile that aren't in the state weights
  if (userProfile.topics) {
    Object.entries(userProfile.topics).forEach(([topic, data]) => {
      if (!state.topicWeights.has(topic)) {
        state.topicWeights.set(topic, data.weight);
      }
    });
  }

  // Add default weight (0.5) for any topic not in the weights map
  // First use ALL_TOPICS to ensure all standard topics have weights
  for (const topic of ALL_TOPICS) {
    if (!state.topicWeights.has(topic)) {
      state.topicWeights.set(topic, 0.5);
    }
  }
  
  // Then add any additional topics from the provided list
  for (const topic of allTopics) {
    if (!state.topicWeights.has(topic)) {
      state.topicWeights.set(topic, 0.5);
    }
  }
  
  console.log("In-session topic weights:");
  Array.from(state.topicWeights.entries()).forEach(([topic, weight]) => {
    console.log(`  ${topic}: ${weight.toFixed(2)}`);
  });
}

// Get questions for the initial branching phase (6-20)
function getBranchingPhaseQuestions(
  allQuestions: FeedItem[],
  groupedQuestions: Map<Topic, Map<Subtopic, FeedItem[]>>,
  state: ColdStartState,
  userProfile: UserProfile
): FeedItem[] {
  // Add detailed debug logging
  console.log("===== DETAILED BRANCHING PHASE DEBUG =====");
  console.log(`Questions shown so far: ${state.questionsShown}`);
  console.log(`Topics shown: ${Array.from(state.topicsShown).join(', ')}`);
  console.log(`Topics in skippedByTopic: ${Array.from(state.skippedByTopic.entries()).map(([topic, count]) => `${topic}(${count})`).join(', ')}`);
  console.log(`Topics in correctAnsweredByTopic: ${Array.from(state.correctAnsweredByTopic.entries()).map(([topic, count]) => `${topic}(${count})`).join(', ')}`);
  console.log(`Topics in wrongAnsweredByTopic: ${Array.from(state.wrongAnsweredByTopic.entries()).map(([topic, count]) => `${topic}(${count})`).join(', ')}`);
  console.log(`Recently used topics: ${state.lastSelectedTopics.join(', ')}`);
  console.log(`All available topics: ${Array.from(groupedQuestions.keys()).join(', ')}`);
  
  // Initialize or update topic weights
  initializeTopicWeights(state, userProfile, Array.from(groupedQuestions.keys()));
  
  // Log in-session weights
  console.log("Current in-session topic weights:");
  Array.from(state.topicWeights.entries()).forEach(([topic, weight]) => {
    console.log(`  ${topic}: ${weight.toFixed(2)}`);
  });
  console.log("===========================================");

  console.log("Getting Initial Branching phase questions (6-20)");

  const selectedQuestions: FeedItem[] = [];
  
  // Clear the topic count for this new batch
  state.topicCountInCurrentBatch.clear();
  
  // Step 1: Select exactly 2 questions based on user interaction (topic/subtopic weights)
  const interactedTopics = new Set<string>();
  const onlySkippedTopics = new Set<string>();
  let hasAnsweredTopics = false;
  
  // Collect topics where the user has answered questions (right or wrong)
  state.correctAnsweredByTopic.forEach((count, topic) => {
    if (count > 0) {
      interactedTopics.add(topic);
      hasAnsweredTopics = true;
      console.log(`Topic ${topic} was answered correctly ${count} times`);
    }
  });
  
  state.wrongAnsweredByTopic.forEach((count, topic) => {
    if (count > 0) {
      interactedTopics.add(topic);
      hasAnsweredTopics = true;
      console.log(`Topic ${topic} was answered incorrectly ${count} times`);
    }
  });
  
  // Collect topics that were only skipped
  state.skippedByTopic.forEach((count, topic) => {
    if (count > 0 && !interactedTopics.has(topic)) {
      onlySkippedTopics.add(topic);
      console.log(`Topic ${topic} was only skipped (${count} times)`);
    }
  });

  console.log(`Has answered topics: ${hasAnsweredTopics}`);
  console.log(`Interacted topics: ${Array.from(interactedTopics).join(', ')}`);
  console.log(`Only skipped topics: ${Array.from(onlySkippedTopics).join(', ')}`);

  // Update the stored list of previously interested topics
  state.previouslyInterestedTopics = Array.from(interactedTopics);
  
  const userPreferredQuestions: FeedItem[] = [];
  
  // If user has answered questions, prioritize those topics with higher weights
  if (hasAnsweredTopics) {
    console.log("User has answered questions, selecting from answered topics");
    
    // Create an array of topics with their weights from in-session state
    const topicsWithWeights = Array.from(interactedTopics).map(topic => {
      // Use in-session state weights
      const weight = state.topicWeights.get(topic) || 0.5;
      
      // NEW: Calculate a diversity score (penalize recently used topics)
      const recentOccurrences = state.lastSelectedTopics.filter(t => t === topic).length;
      const diversityFactor = Math.max(0, 1 - (recentOccurrences * 0.3));
      
      // Combine weight with diversity factor
      const adjustedWeight = weight * diversityFactor;
      
      return { topic, weight: adjustedWeight, originalWeight: weight };
    });
    
    // Sort topics by adjusted weight (descending)
    topicsWithWeights.sort((a, b) => b.weight - a.weight);
    
    console.log("Answered topics sorted by weight with diversity adjustment:");
    topicsWithWeights.forEach(({ topic, weight, originalWeight }) => {
      console.log(`  ${topic}: ${weight.toFixed(2)} (original: ${originalWeight.toFixed(2)})`);
    });
    
    // Prioritize topics with original weight > 0.5 (preferred topics)
    const preferredTopics = topicsWithWeights
      .filter(({ originalWeight }) => originalWeight > PREFERRED_TOPIC_THRESHOLD)
      .map(({ topic }) => topic);
    
    // If no preferred topics, use all topics sorted by adjusted weight
    const topicsArray = preferredTopics.length > 0 
      ? preferredTopics 
      : topicsWithWeights.map(t => t.topic);
    
    console.log(`Using topics: ${topicsArray.join(', ')}`);
    
    for (const topic of topicsArray) {
      if (userPreferredQuestions.length >= 2) break;
      
      // Skip if this topic would violate diversity requirements
      if (!isTopicAllowedForDiversity(state, topic)) {
        console.log(`Skipping topic ${topic} for diversity reasons`);
        continue;
      }
      
      const topicMap = groupedQuestions.get(topic);
      if (!topicMap) continue;
      
      // Get all questions from this topic that haven't been shown
      const availableQuestions = Array.from(topicMap.values()).flat()
        .filter(q => !state.shownQuestionIds.has(q.id));
      
      console.log(`Topic ${topic} has ${availableQuestions.length} available questions (weight: ${state.topicWeights.get(topic)?.toFixed(2) || 'default'})`);
        
      if (availableQuestions.length > 0) {
        // Randomly select a question from this topic
        const question = availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
        userPreferredQuestions.push(question);
        
        // Mark as shown but NOT as an exploration question
        state.shownQuestionIds.add(question.id);
        state.topicsShown.add(topic); // Ensure topic is marked as shown
        
        // Track this topic for diversity
        trackTopicForDiversity(state, topic);
        
        console.log(`Selected question from answered topic ${topic}: "${question.question?.substring(0, 30)}..."`);
        
        // Add to recent topics for diversity tracking
        state.recentTopics.unshift(topic);
        if (state.recentTopics.length > 5) {
          state.recentTopics.pop();
        }
      }
    }
  }
  // If user has only skipped questions, select from ANY unused topics
  else {
    console.log("User has only skipped questions, selecting from unused topics");
    
    // Get ALL unused topics
    const allUnusedTopics = Array.from(groupedQuestions.keys())
      .filter(topic => !state.topicsShown.has(topic));
    
    console.log(`Found ${allUnusedTopics.length} unused topics: ${allUnusedTopics.join(', ')}`);
    
    if (allUnusedTopics.length > 0) {
      // NEW: Prioritize topics that are not in the last used topics
      const topicsWithDiversityScore = allUnusedTopics.map(topic => {
        const weight = state.topicWeights.get(topic) || 0.5;
        
        // Check if this topic appears in the recent topics list
        const isRecentlyUsed = state.lastSelectedTopics.includes(topic);
        
        // Higher score for topics not recently used
        const diversityScore = isRecentlyUsed ? 0 : 1;
        
        // Combine weight with diversity score
        const adjustedWeight = weight * (1 + diversityScore);
        
        return { topic, weight, adjustedWeight };
      });
      
      // Sort by adjusted weight (descending)
      topicsWithDiversityScore.sort((a, b) => b.adjustedWeight - a.adjustedWeight);
      
      console.log("Unused topics with adjusted weights for diversity:");
      topicsWithDiversityScore.forEach(({ topic, weight, adjustedWeight }) => {
        console.log(`  ${topic}: ${weight.toFixed(2)} (adjusted: ${adjustedWeight.toFixed(2)})`);
      });
      
      // Get preferred topics (weight > 0.5)
      const preferredUnusedTopics = topicsWithDiversityScore
        .filter(({ weight }) => weight > PREFERRED_TOPIC_THRESHOLD)
        .map(({ topic }) => topic);
      
      console.log(`Found ${preferredUnusedTopics.length} unused preferred topics (weight > ${PREFERRED_TOPIC_THRESHOLD})`);
          
      // If we have preferred topics, use them, otherwise use all sorted by weight
      let sortedUnusedTopics = preferredUnusedTopics.length > 0 
        ? preferredUnusedTopics 
        : topicsWithDiversityScore.map(t => t.topic);
      
      console.log(`Final sorted unused topics: ${sortedUnusedTopics.join(', ')}`);
      
      // Try to select 2 questions from preferred unused topics
      for (const topic of sortedUnusedTopics) {
        if (userPreferredQuestions.length >= 2) break;
          
        // Skip if this topic would violate diversity requirements
        if (!isTopicAllowedForDiversity(state, topic)) {
          console.log(`Skipping topic ${topic} for diversity reasons`);
          continue;
        }
        
        const topicMap = groupedQuestions.get(topic);
        if (!topicMap) {
          console.log(`No questions available for topic ${topic}`);
          continue;
        }
        
        // Get all questions from this topic that haven't been shown
        const availableQuestions = Array.from(topicMap.values()).flat()
          .filter(q => !state.shownQuestionIds.has(q.id));
        
        console.log(`Unused topic ${topic} has ${availableQuestions.length} available questions (weight: ${state.topicWeights.get(topic)?.toFixed(2) || 'default'})`);
          
        if (availableQuestions.length > 0) {
          // Randomly select a question from this topic
          const question = availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
          userPreferredQuestions.push(question);
          
          // Mark as shown but NOT as an exploration question
          state.shownQuestionIds.add(question.id);
          state.topicsShown.add(topic); // Mark topic as shown
            
          // Track this topic for diversity
          trackTopicForDiversity(state, topic);
            
          console.log(`Added question from unused topic: ${topic} - "${question.question?.substring(0, 30)}..."`);
          
          // Add to recent topics for diversity tracking
          state.recentTopics.unshift(topic);
          if (state.recentTopics.length > 5) {
            state.recentTopics.pop();
          }
        }
      }
    }
  }
  
  // Step 2: Select exactly 2 exploration questions from topics that haven't been shown yet
  const explorationQuestions: FeedItem[] = [];
  
  // Get a complete list of all possible topics from groupedQuestions
  const allAvailableTopics = Array.from(groupedQuestions.keys());
  console.log(`All available topics (${allAvailableTopics.length}): ${allAvailableTopics.join(', ')}`);
  
  // Find topics that haven't been shown OR interacted with at all
  // This is the key improvement - we need to consider both shown and skipped topics as "used"
  const completelyNewTopics = allAvailableTopics.filter(topic => 
    !state.topicsShown.has(topic) && 
    !state.skippedByTopic.has(topic) &&
    !userPreferredQuestions.some(q => q.topic === topic) &&
    !state.lastSelectedTopics.includes(topic)
  );
  
  console.log(`EXPLORATION IMPROVEMENT: Found ${completelyNewTopics.length} completely new topics: ${completelyNewTopics.join(', ')}`);
  
  // Fallback to topics that haven't been shown but may have been skipped
  const unusedButMaybeSkippedTopics = allAvailableTopics.filter(topic => 
    !state.topicsShown.has(topic) && 
    !userPreferredQuestions.some(q => q.topic === topic) &&
    !state.lastSelectedTopics.includes(topic)
  );
  
  console.log(`Unused but maybe skipped topics: ${unusedButMaybeSkippedTopics.length} topics: ${unusedButMaybeSkippedTopics.join(', ')}`);
  
  // Fall back to any topic not recently used if needed
  const notRecentlyUsedTopics = allAvailableTopics.filter(topic => 
    !state.lastSelectedTopics.includes(topic) &&
    !userPreferredQuestions.some(q => q.topic === topic)
  );
  
  console.log(`Not recently used topics: ${notRecentlyUsedTopics.length} topics: ${notRecentlyUsedTopics.join(', ')}`);
  
  // Prioritize in this order: completely new > unused but skipped > not recently used
  const prioritizedExplorationTopics = [
    ...completelyNewTopics,
    ...unusedButMaybeSkippedTopics.filter(t => !completelyNewTopics.includes(t)),
    ...notRecentlyUsedTopics.filter(t => 
      !completelyNewTopics.includes(t) && 
      !unusedButMaybeSkippedTopics.includes(t)
    )
  ];
  
  // Add some randomness to avoid always picking the same topics
  shuffleArray(prioritizedExplorationTopics);
  
  console.log(`Final prioritized exploration topics (after shuffle): ${prioritizedExplorationTopics.slice(0, 10).join(', ')}${prioritizedExplorationTopics.length > 10 ? '...' : ''}`);
  
  // First try to get questions from prioritized exploration topics
  for (const topic of prioritizedExplorationTopics) {
    if (explorationQuestions.length >= 2) break;
    
    // Skip topics already used in userPreferredQuestions
    if (userPreferredQuestions.some(q => q.topic === topic)) {
      console.log(`Skipping topic ${topic} for exploration as it was already used for user-preferred questions`);
      continue;
    }
    
    // Skip if this topic would violate diversity requirements
    if (!isTopicAllowedForDiversity(state, topic)) {
      console.log(`Skipping topic ${topic} for diversity reasons`);
      continue;
    }
    
    const topicMap = groupedQuestions.get(topic);
    if (!topicMap) {
      console.log(`No questions available for topic ${topic}`);
      continue;
    }
    
    // Get all questions from this topic that haven't been shown
    const availableQuestions = Array.from(topicMap.values()).flat()
      .filter(q => !state.shownQuestionIds.has(q.id));
    
    console.log(`Exploration topic ${topic} has ${availableQuestions.length} available questions (weight: ${state.topicWeights.get(topic)?.toFixed(2) || 'default'})`);
      
    if (availableQuestions.length > 0) {
      // Randomly select a question from this topic
      const question = availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
      explorationQuestions.push(question);
      
      // Mark as shown AND as an exploration question
      state.shownQuestionIds.add(question.id);
      state.topicsShown.add(topic);
      state.isExplorationQuestion.add(question.id);
      
      // Track this topic for diversity
      trackTopicForDiversity(state, topic);
      
      console.log(`Added exploration question from topic: ${topic} - "${question.question?.substring(0, 30)}..."`);
      
      // Add to recent topics for diversity tracking
      state.recentTopics.unshift(topic);
      if (state.recentTopics.length > 5) {
        state.recentTopics.pop();
      }
    }
  }
  
  // If still don't have enough exploration questions, use any unseen questions from any topic
  if (explorationQuestions.length < 2) {
    console.log("Still need more exploration questions, using any unseen questions");
    
    const remainingQuestions = allQuestions
      .filter(q => !state.shownQuestionIds.has(q.id))
      .filter(q => !userPreferredQuestions.some(pq => pq.id === q.id))
      .filter(q => !explorationQuestions.some(eq => eq.id === q.id));
      
    shuffleArray(remainingQuestions);
    
    for (const question of remainingQuestions) {
      if (explorationQuestions.length >= 2) break;
      
      // Skip if this topic would violate diversity requirements
      if (!isTopicAllowedForDiversity(state, question.topic)) {
        console.log(`Skipping random question from topic ${question.topic} for diversity reasons`);
        continue;
      }
      
      explorationQuestions.push(question);
      
      // Mark as shown AND as an exploration question
      state.shownQuestionIds.add(question.id);
      state.isExplorationQuestion.add(question.id);
      
      // Track this topic for diversity
      trackTopicForDiversity(state, question.topic);
      
      console.log(`Selected final exploration question from topic: ${question.topic} (weight: ${state.topicWeights.get(question.topic)?.toFixed(2) || 'default'})`);
      
      // Add to recent topics for diversity tracking
      state.recentTopics.unshift(question.topic);
      if (state.recentTopics.length > 5) {
        state.recentTopics.pop();
      }
    }
  }
  
  // Combine the preferred and exploration questions
  selectedQuestions.push(...userPreferredQuestions, ...explorationQuestions);
  
  // Log comprehensive info about the selection
  console.log(`Returning ${userPreferredQuestions.length} user preferred questions and ${explorationQuestions.length} exploration questions`);
  console.log(`Selected topics: ${selectedQuestions.map(q => q.topic).join(', ')}`);
  console.log(`Topics now shown: ${Array.from(state.topicsShown).join(', ')}`);
  console.log(`Topic distribution in this batch: ${Array.from(state.topicCountInCurrentBatch.entries()).map(([topic, count]) => `${topic}: ${count}`).join(', ')}`);
  
  return selectedQuestions;
}

// Get questions for the normal state (beyond 20 questions)
function getNormalPhaseQuestions(
  allQuestions: FeedItem[],
  groupedQuestions: Map<Topic, Map<Subtopic, FeedItem[]>>,
  state: ColdStartState,
  userProfile: UserProfile
): FeedItem[] {
  console.log("Getting Normal phase questions (beyond 20)");

  // Initialize or update topic weights
  initializeTopicWeights(state, userProfile, Array.from(groupedQuestions.keys()));
  
  // Log in-session weights
  console.log("Current in-session topic weights for normal phase:");
  Array.from(state.topicWeights.entries()).forEach(([topic, weight]) => {
    console.log(`  ${topic}: ${weight.toFixed(2)}`);
  });

  const selectedQuestions: FeedItem[] = [];
  
  // Clear the topic count for this new batch
  state.topicCountInCurrentBatch.clear();
  
  // Get topics sorted by weight (descending)
  const sortedTopics = Array.from(state.topicWeights.entries())
    .sort((a, b) => b[1] - a[1]);
  
  // Get preferred topics (those with weight > PREFERRED_TOPIC_THRESHOLD)
  const preferredTopics: {topic: string, weight: number}[] = [];
    
  // Add topics with high weights first
  for (const [topic, weight] of sortedTopics) {
    if (weight > PREFERRED_TOPIC_THRESHOLD) {
      preferredTopics.push({topic, weight});
    }
  }
  
  console.log(`Found ${preferredTopics.length} preferred topics (weight > ${PREFERRED_TOPIC_THRESHOLD}): ${preferredTopics.map(t => t.topic).join(', ')}`);
  
  // Calculate selection probability based on weight
  const totalPreferredWeight = preferredTopics.reduce((sum, t) => sum + (t.weight - PREFERRED_TOPIC_THRESHOLD), 0);
  const normalizedPreferredTopics = preferredTopics.map(({topic, weight}) => {
    // Normalize probability based on how much higher than threshold
    const normalizedWeight = (weight - PREFERRED_TOPIC_THRESHOLD) / totalPreferredWeight;
    return {topic, weight, normalizedWeight};
  });
  
  console.log("Preferred topics with normalized weights for proportional selection:");
  normalizedPreferredTopics.forEach(({topic, weight, normalizedWeight}) => {
    console.log(`  ${topic}: Weight ${weight.toFixed(2)}, Selection Probability: ${(normalizedWeight * 100).toFixed(1)}%`);
  });
  
  // If we don't have enough preferred topics, add the top 3 topics by weight
  if (preferredTopics.length < 3) {
    // Filter out topics we've already added
    const remainingTopics = sortedTopics
      .filter(([topic, _]) => !preferredTopics.some(pt => pt.topic === topic));
  
    // Add the top remaining topics
    const additionalTopics = remainingTopics.slice(0, 3 - preferredTopics.length).map(([topic, weight]) => ({
      topic,
      weight,
      normalizedWeight: 0.1 // Give lower probability to added topics
    }));
    
    normalizedPreferredTopics.push(...additionalTopics);
    
    console.log(`Added ${additionalTopics.length} additional topics to reach minimum 3 preferred topics: ${additionalTopics.map(t => t.topic).join(', ')}`);
  }
  
  // Get questions from preferred topics (70%)
  const preferredCount = Math.ceil(4 * 0.7); // 70% of 4 = 3 questions (rounded up)
  const preferredQuestions: FeedItem[] = [];
  
  // Keep track of used topics for diversity
  const usedTopics = new Set<string>();
  
  // Check for underrepresented topics that should be prioritized
  const underrepresentedTopics = normalizedPreferredTopics
    .filter(({topic}) => {
      const currentCount = state.topicCountInCurrentBatch.get(topic) || 0;
      const normalizedWeight = normalizedPreferredTopics.find(t => t.topic === topic)?.normalizedWeight || 0;
      // Topic is underrepresented if its count percentage is below its weight percentage
      const isUnderrepresented = currentCount === 0 && normalizedWeight > 0.1;
      if (isUnderrepresented) {
        console.log(`Topic ${topic} is underrepresented (count: ${currentCount}, weight: ${normalizedWeight.toFixed(2)}) - prioritizing`);
      }
      return isUnderrepresented;
    })
    .map(({topic}) => topic);
  
  // First pass: try to include underrepresented topics
  if (underrepresentedTopics.length > 0) {
    console.log(`Prioritizing ${underrepresentedTopics.length} underrepresented topics: ${underrepresentedTopics.join(', ')}`);
    
    for (const topic of underrepresentedTopics) {
    if (preferredQuestions.length >= preferredCount) break;
      
      // Skip if this topic would violate diversity requirements
      if (!isTopicAllowedForDiversity(state, topic)) {
        console.log(`Skipping underrepresented topic ${topic} for diversity reasons`);
        continue;
      }
    
    const topicMap = groupedQuestions.get(topic);
    if (!topicMap) continue;
    
    // Get all questions from this topic that haven't been shown
    const availableQuestions = Array.from(topicMap.values()).flat()
      .filter(q => !state.shownQuestionIds.has(q.id));
      
    if (availableQuestions.length > 0) {
      // Randomly select a question from this topic
      const question = availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
      preferredQuestions.push(question);
      
      // Mark as shown but NOT as an exploration question
      state.shownQuestionIds.add(question.id);
      usedTopics.add(topic);
        
        // Track this topic for diversity
        trackTopicForDiversity(state, topic);
        
        console.log(`Selected preferred question from underrepresented topic ${topic} (weight: ${state.topicWeights.get(topic)?.toFixed(2) || 'default'})`);
      
      // Add to recent topics for diversity tracking
      state.recentTopics.unshift(topic);
      if (state.recentTopics.length > 5) {
        state.recentTopics.pop();
        }
      }
    }
  }
  
  // Second pass: select remaining preferred questions using weighted probability
  const attemptsLimit = 20; // Avoid infinite loop if we can't find suitable questions
  let attempts = 0;
  
  while (preferredQuestions.length < preferredCount && attempts < attemptsLimit) {
    attempts++;
    
    // Select topic with probability proportional to weight
    const randomValue = Math.random();
    let cumulativeProbability = 0;
    let selectedTopic: string | null = null;
    
    // Skip topics that would violate diversity requirements
    const eligibleTopics = normalizedPreferredTopics
      .filter(({topic}) => !usedTopics.has(topic) && isTopicAllowedForDiversity(state, topic));
    
    // Recalculate probabilities for remaining topics
    const eligibleTotalWeight = eligibleTopics.reduce((sum, t) => sum + t.normalizedWeight, 0);
    
    for (const {topic, normalizedWeight} of eligibleTopics) {
      // Adjust probability based on remaining eligible topics
      const adjustedProbability = normalizedWeight / eligibleTotalWeight;
      cumulativeProbability += adjustedProbability;
      
      if (randomValue <= cumulativeProbability) {
        selectedTopic = topic;
        break;
      }
    }
    
    // If no topic was selected by probability (e.g., all filtered out), pick a random eligible topic
    if (!selectedTopic && eligibleTopics.length > 0) {
      selectedTopic = eligibleTopics[Math.floor(Math.random() * eligibleTopics.length)].topic;
      console.log(`No topic selected by probability, randomly selected ${selectedTopic}`);
    }
    
    if (!selectedTopic) {
      console.log(`No eligible topics available for selection on attempt ${attempts}`);
      continue;
    }
    
    console.log(`Selected topic ${selectedTopic} based on weight probability on attempt ${attempts}`);
    
    const topicMap = groupedQuestions.get(selectedTopic);
    if (!topicMap) continue;
    
    // Get all questions from this topic that haven't been shown
    const availableQuestions = Array.from(topicMap.values()).flat()
      .filter(q => !state.shownQuestionIds.has(q.id));
      
    if (availableQuestions.length > 0) {
      // Randomly select a question from this topic
      const question = availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
      preferredQuestions.push(question);
      
      // Mark as shown but NOT as an exploration question
      state.shownQuestionIds.add(question.id);
      usedTopics.add(selectedTopic);
      
      // Track this topic for diversity
      trackTopicForDiversity(state, selectedTopic);
      
      console.log(`Selected preferred question from topic ${selectedTopic} (weight: ${state.topicWeights.get(selectedTopic)?.toFixed(2) || 'default'})`);
      
      // Add to recent topics for diversity tracking
      state.recentTopics.unshift(selectedTopic);
      if (state.recentTopics.length > 5) {
        state.recentTopics.pop();
      }
    } else {
      console.log(`Topic ${selectedTopic} has no available questions, skipping`);
    }
  }
  
  // If we still need more preferred questions, get questions from any topic with weight > 0.3
  if (preferredQuestions.length < preferredCount) {
    const mediumWeightTopics = Array.from(state.topicWeights.entries())
      .filter(([topic, weight]) => weight > 0.3 && !usedTopics.has(topic))
      .map(([topic, _]) => topic);
    
    console.log(`Found ${mediumWeightTopics.length} medium-weight topics (weight > 0.3) for additional preferred questions`);
    
    shuffleArray(mediumWeightTopics);
    
    for (const topic of mediumWeightTopics) {
      if (preferredQuestions.length >= preferredCount) break;
      
      // Skip if this topic would violate diversity requirements
      if (!isTopicAllowedForDiversity(state, topic)) {
        console.log(`Skipping medium-weight topic ${topic} for diversity reasons`);
        continue;
      }
      
      const topicMap = groupedQuestions.get(topic);
      if (!topicMap) continue;
      
      // Get all questions from this topic that haven't been shown
      const availableQuestions = Array.from(topicMap.values()).flat()
        .filter(q => !state.shownQuestionIds.has(q.id));
        
      if (availableQuestions.length > 0) {
        // Randomly select a question from this topic
        const question = availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
        preferredQuestions.push(question);
        
        // Mark as shown but NOT as an exploration question
        state.shownQuestionIds.add(question.id);
        usedTopics.add(topic);
        
        // Track this topic for diversity
        trackTopicForDiversity(state, topic);
        
        console.log(`Selected additional preferred question from medium-weight topic ${topic} (weight: ${state.topicWeights.get(topic)?.toFixed(2) || 'default'})`);
        
        // Add to recent topics for diversity tracking
        state.recentTopics.unshift(topic);
        if (state.recentTopics.length > 5) {
          state.recentTopics.pop();
        }
      }
    }
  }
  
  // Get exploration questions (30%)
  const explorationCount = 4 - preferredQuestions.length; // Remaining questions (should be 1 typically)
  const explorationQuestions: FeedItem[] = [];
  
  // Improved exploration topic logic for normal phase - get completely new topics first
  // Get a complete list of all possible topics from groupedQuestions
  const allAvailableTopics = Array.from(groupedQuestions.keys());
  console.log(`NORMAL PHASE: All available topics (${allAvailableTopics.length}): ${allAvailableTopics.join(', ')}`);
  
  // Find completely new topics that haven't been shown at all
  const completelyNewTopics = allAvailableTopics.filter(topic => 
    // Never shown before
    !state.topicsShown.has(topic) &&
    // Not already used in this batch
    !usedTopics.has(topic) &&
    // Not in recent topics
    !state.recentTopics.includes(topic) &&
    // Not in already selected questions
    !preferredQuestions.some(q => q.topic === topic)
  );
  
  console.log(`NORMAL PHASE: Found ${completelyNewTopics.length} completely new topics: ${completelyNewTopics.join(', ')}`);
  
  // Get topics with low weights (≤ PREFERRED_TOPIC_THRESHOLD) for exploration
  const lowWeightTopics = Array.from(state.topicWeights.entries())
    .filter(([topic, weight]) => 
      weight <= PREFERRED_TOPIC_THRESHOLD && 
      !usedTopics.has(topic) &&
      !preferredQuestions.some(q => q.topic === topic)
    )
    .map(([topic, _]) => topic);
    
  console.log(`NORMAL PHASE: Found ${lowWeightTopics.length} low-weight exploration candidates: ${lowWeightTopics.join(', ')}`);
  
  // Prioritize in this order: completely new topics > low weight topics > any unused topic
  const prioritizedExplorationTopics = [
    ...completelyNewTopics,
    ...lowWeightTopics.filter(t => !completelyNewTopics.includes(t)),
    ...allAvailableTopics.filter(t => 
      !completelyNewTopics.includes(t) && 
      !lowWeightTopics.includes(t) &&
      !usedTopics.has(t) &&
      !preferredQuestions.some(q => q.topic === t)
    )
  ];
  
  // Add randomness to exploration topics to prevent always picking the same ones
  shuffleArray(prioritizedExplorationTopics);
  
  console.log(`NORMAL PHASE: Prioritized exploration topics: ${prioritizedExplorationTopics.slice(0, 10).join(', ')}${prioritizedExplorationTopics.length > 10 ? '...' : ''}`);
  
  // First try to get questions from prioritized exploration topics
  for (const topic of prioritizedExplorationTopics) {
    if (explorationQuestions.length >= explorationCount) break;
    
    // Skip if this topic would violate diversity requirements
    if (!isTopicAllowedForDiversity(state, topic)) {
      console.log(`NORMAL PHASE: Skipping exploration topic ${topic} for diversity reasons`);
      continue;
    }
    
    const topicMap = groupedQuestions.get(topic);
    if (!topicMap) {
      console.log(`NORMAL PHASE: No questions available for topic ${topic}`);
      continue;
    }
    
    // Get all questions from this topic that haven't been shown
    const availableQuestions = Array.from(topicMap.values()).flat()
      .filter(q => !state.shownQuestionIds.has(q.id));
      
    if (availableQuestions.length > 0) {
      // Randomly select a question from this topic
      const question = availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
      explorationQuestions.push(question);
      
      // Mark as shown AND as an exploration question
      state.shownQuestionIds.add(question.id);
      state.isExplorationQuestion.add(question.id);
      
      // Track this topic for diversity
      trackTopicForDiversity(state, topic);
      
      console.log(`NORMAL PHASE: Selected exploration question from topic ${topic} (weight: ${state.topicWeights.get(topic)?.toFixed(2) || 'default'})`);
      
      // Add to recent topics for diversity tracking
      state.recentTopics.unshift(topic);
      if (state.recentTopics.length > 5) {
        state.recentTopics.pop();
      }
    } else {
      console.log(`NORMAL PHASE: Topic ${topic} has no available questions`);
    }
  }
  
  // If we still don't have enough exploration questions, pick from any remaining topic
  if (explorationQuestions.length < explorationCount) {
    console.log("NORMAL PHASE: Still need more exploration questions, using any remaining questions");
    
    // Get all remaining questions that aren't in shown question IDs or selected questions
    const remainingQuestions = allQuestions
      .filter(q => !state.shownQuestionIds.has(q.id))
      .filter(q => !preferredQuestions.some(pq => pq.id === q.id))
      .filter(q => !explorationQuestions.some(eq => eq.id === q.id));
      
    console.log(`NORMAL PHASE: Found ${remainingQuestions.length} remaining questions for exploration`);
      
    // Add randomness to prevent always picking the same fallback questions
    shuffleArray(remainingQuestions);
    
    // Use a different approach to select questions - prioritize by topic diversity
    for (const question of remainingQuestions) {
      if (explorationQuestions.length >= explorationCount) break;
      
      // Skip if topic is already used in this batch
      if (usedTopics.has(question.topic) || 
          preferredQuestions.some(q => q.topic === question.topic) ||
          explorationQuestions.some(q => q.topic === question.topic)) {
        continue;
      }
      
      // Skip if this topic would violate diversity requirements
      if (!isTopicAllowedForDiversity(state, question.topic)) {
        console.log(`NORMAL PHASE: Skipping fallback question from topic ${question.topic} for diversity reasons`);
        continue;
      }
      
      explorationQuestions.push(question);
      
      // Mark as shown AND as an exploration question
      state.shownQuestionIds.add(question.id);
      state.isExplorationQuestion.add(question.id);
      
      // Track this topic for diversity
      trackTopicForDiversity(state, question.topic);
      
      console.log(`NORMAL PHASE: Selected final exploration question from topic ${question.topic} (weight: ${state.topicWeights.get(question.topic)?.toFixed(2) || 'default'})`);
      
      // Add to recent topics for diversity tracking
      state.recentTopics.unshift(question.topic);
      if (state.recentTopics.length > 5) {
        state.recentTopics.pop();
      }
    }
    
    // Last resort - if we still need questions and can't find topics not yet used in this batch
    if (explorationQuestions.length < explorationCount) {
      console.log("NORMAL PHASE: LAST RESORT - using any available question for remaining slots");
      
      // Reset and use any question not already selected, even if from a used topic
      const anyRemainingQuestions = allQuestions
        .filter(q => !state.shownQuestionIds.has(q.id))
        .filter(q => !preferredQuestions.some(pq => pq.id === q.id))
        .filter(q => !explorationQuestions.some(eq => eq.id === q.id));
        
      shuffleArray(anyRemainingQuestions);
      
      for (const question of anyRemainingQuestions) {
        if (explorationQuestions.length >= explorationCount) break;
        
        // Only check diversity to avoid same topic appearing too often
        if (!isTopicAllowedForDiversity(state, question.topic)) {
          console.log(`NORMAL PHASE: Skipping last-resort question from topic ${question.topic} for diversity reasons`);
          continue;
        }
        
        explorationQuestions.push(question);
        
        // Mark as shown AND as an exploration question
        state.shownQuestionIds.add(question.id);
        state.isExplorationQuestion.add(question.id);
        
        // Track this topic for diversity
        trackTopicForDiversity(state, question.topic);
        
        console.log(`NORMAL PHASE: Selected absolute last-resort question from topic ${question.topic}`);
        
        // Add to recent topics for diversity tracking
        state.recentTopics.unshift(question.topic);
        if (state.recentTopics.length > 5) {
          state.recentTopics.pop();
        }
      }
    }
  }
  
  // Combine the preferred and exploration questions
  selectedQuestions.push(...preferredQuestions, ...explorationQuestions);
  
  console.log(`NORMAL PHASE: Returning ${preferredQuestions.length} preferred questions and ${explorationQuestions.length} exploration questions`);
  console.log(`NORMAL PHASE: Selected topics: ${selectedQuestions.map(q => q.topic).join(', ')}`);
  console.log(`NORMAL PHASE: Topic distribution in this batch: ${Array.from(state.topicCountInCurrentBatch.entries()).map(([topic, count]) => `${topic}: ${count}`).join(', ')}`);
  
  return selectedQuestions;
}

// Helper function to shuffle an array in-place
function shuffleArray<T>(array: T[]): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

// Helper function to filter by difficulty
function filterByDifficulty(questions: FeedItem[], state: ColdStartState): FeedItem[] {
  if (state.questionsShown < 10) {
    // First 10 questions should be easy or medium only
    return questions.filter(q => 
      (q.difficulty?.toLowerCase() === 'easy' || q.difficulty?.toLowerCase() === 'medium')
    );
  }
  return questions;
}

// Helper function to convert a ColdStartState to a serializable object
function serializeColdStartState(state: ColdStartState): any {
  return {
    phase: state.phase,
    questionsShown: state.questionsShown,
    topicsShown: Array.from(state.topicsShown),
    shownQuestionIds: Array.from(state.shownQuestionIds),
    subtopicsShown: Array.from(state.subtopicsShown.entries()).map(([topic, subtopics]) => 
      [topic, Array.from(subtopics)]
    ),
    recentTopics: state.recentTopics,
    correctAnsweredByTopic: Array.from(state.correctAnsweredByTopic.entries()),
    wrongAnsweredByTopic: Array.from(state.wrongAnsweredByTopic.entries()),
    skippedByTopic: Array.from(state.skippedByTopic.entries()),
    previouslyInterestedTopics: state.previouslyInterestedTopics,
    isExplorationQuestion: Array.from(state.isExplorationQuestion),
    topicWeights: Array.from(state.topicWeights.entries()),
    topicCountInCurrentBatch: Array.from(state.topicCountInCurrentBatch.entries()),
    lastSelectedTopics: state.lastSelectedTopics
  };
}

// Helper function to convert a serialized state back to a ColdStartState
function deserializeColdStartState(serializedState: any): ColdStartState {
  const state = initColdStartState();
  
  state.phase = serializedState.phase;
  state.questionsShown = serializedState.questionsShown;
  
  // Convert arrays back to Sets
  if (Array.isArray(serializedState.topicsShown)) {
    state.topicsShown = new Set(serializedState.topicsShown);
  }
  
  if (Array.isArray(serializedState.shownQuestionIds)) {
    state.shownQuestionIds = new Set(serializedState.shownQuestionIds);
  }
  
  // Convert array of entries back to Maps
  if (Array.isArray(serializedState.correctAnsweredByTopic)) {
    state.correctAnsweredByTopic = new Map(serializedState.correctAnsweredByTopic);
  }
  
  if (Array.isArray(serializedState.wrongAnsweredByTopic)) {
    state.wrongAnsweredByTopic = new Map(serializedState.wrongAnsweredByTopic);
  }
  
  if (Array.isArray(serializedState.skippedByTopic)) {
    state.skippedByTopic = new Map(serializedState.skippedByTopic);
  }
  
  // Handle subtopicsShown Map<Topic, Set<Subtopic>>
  if (Array.isArray(serializedState.subtopicsShown)) {
    state.subtopicsShown = new Map();
    serializedState.subtopicsShown.forEach(([topic, subtopics]: [Topic, any[]]) => {
      state.subtopicsShown.set(topic, new Set(subtopics));
    });
  }
  
  // Simple arrays
  state.recentTopics = serializedState.recentTopics || [];
  state.previouslyInterestedTopics = serializedState.previouslyInterestedTopics || [];
  
  // Convert exploration question array back to Set
  if (Array.isArray(serializedState.isExplorationQuestion)) {
    state.isExplorationQuestion = new Set(serializedState.isExplorationQuestion);
  }
  
  // Convert topicWeights array back to Map
  if (Array.isArray(serializedState.topicWeights)) {
    state.topicWeights = new Map(serializedState.topicWeights);
  }
  
  // Convert topicCountInCurrentBatch array back to Map
  if (Array.isArray(serializedState.topicCountInCurrentBatch)) {
    state.topicCountInCurrentBatch = new Map(serializedState.topicCountInCurrentBatch);
  }
  
  // Convert lastSelectedTopics array back to array
  state.lastSelectedTopics = serializedState.lastSelectedTopics || [];
  
  return state;
}

// Main function to get the cold start feed
export function getColdStartFeed(
  allQuestions: FeedItem[],
  userProfile: UserProfile,
  groupedQuestions: Map<Topic, Map<Subtopic, FeedItem[]>> | Record<string, any> = new Map(),
  forcedPhase?: 'exploration' | 'branching' | 'normal' // Add parameter to force a specific phase
): { items: FeedItem[], state: ColdStartState, explanations: { [questionId: string]: string[] } } {
  let state: ColdStartState;
  const explanations: { [questionId: string]: string[] } = {};
  
  // Check if we need to create a new cold start state
  if (!userProfile.coldStartState) {
    console.log("Initializing new cold start state");
    state = initColdStartState();
  } else {
    console.log("Loading existing cold start state");
    state = deserializeColdStartState(userProfile.coldStartState);
  }
  
  // Handle previous question answers if they exist
  if (userProfile.lastQuestionAnswered) {
    const { questionId, answer, correct, skipped, topic } = userProfile.lastQuestionAnswered;
  
    // Skip if we've already processed this question
    if (!state.shownQuestionIds.has(questionId)) {
      console.log(`Question ${questionId} was not in shown question IDs, can't process answer`);
    } else {
      console.log(`Processing answer for question ${questionId} (topic: ${topic})`);
      
      // Increment the appropriate counter
      if (skipped) {
        const count = state.skippedByTopic.get(topic) || 0;
        state.skippedByTopic.set(topic, count + 1);
        console.log(`Recorded skipped question in ${topic}`);
      } else if (correct) {
        const count = state.correctAnsweredByTopic.get(topic) || 0;
        state.correctAnsweredByTopic.set(topic, count + 1);
        console.log(`Recorded correctly answered question in ${topic}`);
    
        // Update in-session weight for correct answers - increase weight
        const currentWeight = state.topicWeights.get(topic) || 0.5;
        const newWeight = Math.min(1.0, currentWeight + 0.1);
        state.topicWeights.set(topic, newWeight);
        console.log(`Updated weight for ${topic} after correct answer: ${currentWeight.toFixed(2)} -> ${newWeight.toFixed(2)}`);
      } else {
        const count = state.wrongAnsweredByTopic.get(topic) || 0;
        state.wrongAnsweredByTopic.set(topic, count + 1);
        console.log(`Recorded incorrectly answered question in ${topic}`);
        
        // Update in-session weight for wrong answers - still increase, but less
        const currentWeight = state.topicWeights.get(topic) || 0.5;
        const newWeight = Math.min(1.0, currentWeight + 0.05);
        state.topicWeights.set(topic, newWeight);
        console.log(`Updated weight for ${topic} after wrong answer: ${currentWeight.toFixed(2)} -> ${newWeight.toFixed(2)}`);
      }
      
      // For exploration questions that were answered (not skipped), adjust other weights
      if (!skipped && state.isExplorationQuestion.has(questionId)) {
        console.log(`Question ${questionId} was an exploration question and was answered (correct: ${correct})`);
        
        // If user engaged with an exploration topic, slightly decrease other weights
        Object.keys(userProfile.topics || {}).forEach(otherTopic => {
          if (otherTopic !== topic) {
            const currentWeight = state.topicWeights.get(otherTopic) || 0.5;
            const newWeight = Math.max(0.1, currentWeight - 0.02);
            state.topicWeights.set(otherTopic, newWeight);
          }
        });
        
        console.log(`Adjusted weights of other topics after exploration question was answered`);
      }
    }
    
    // Clear the last answered question to avoid double processing
    userProfile.lastQuestionAnswered = undefined;
  }
  
  // Filter questions by difficulty for the first 10 questions
  const filteredQuestions = filterByDifficulty(allQuestions, state);
  
  // Ensure we have a Map for grouped questions and that it's not empty
  const filteredGroupedQuestions = (groupedQuestions instanceof Map && Array.from(groupedQuestions.keys()).length > 0)
    ? groupedQuestions
    : groupQuestionsByTopic(filteredQuestions);
  
  // Add debug logging to see if grouped questions is properly populated
  console.log(`DEBUG: groupedQuestions has ${filteredGroupedQuestions.size} topics`);
  console.log(`DEBUG: Topics in groupedQuestions: ${Array.from(filteredGroupedQuestions.keys()).join(', ')}`);
  
  // Determine the phase based on questions shown
  if (state.questionsShown < 5) {
    state.phase = 'exploration';
  } else if (state.questionsShown < 20) {
    state.phase = 'branching';
  } else {
    state.phase = 'normal';
  }
  
  // Override the phase if forced, but only after determining the natural phase first
  if (forcedPhase) {
    console.log(`Forcing phase to ${forcedPhase} (overriding ${state.phase})`);
    state.phase = forcedPhase;
  }
  
  console.log(`Cold start phase: ${state.phase}, Questions shown: ${state.questionsShown}`);
  
  // Get questions for the current phase
  let phaseQuestions: FeedItem[] = [];
  
  switch (state.phase) {
    case 'exploration':
      phaseQuestions = getExplorationPhaseQuestions(filteredQuestions, filteredGroupedQuestions, state, userProfile);
      break;
    case 'branching':
      phaseQuestions = getBranchingPhaseQuestions(filteredQuestions, filteredGroupedQuestions, state, userProfile);
      break;
    case 'normal':
      phaseQuestions = getNormalPhaseQuestions(filteredQuestions, filteredGroupedQuestions, state, userProfile);
      break;
    default:
      phaseQuestions = getExplorationPhaseQuestions(filteredQuestions, filteredGroupedQuestions, state, userProfile);
      break;
  }
  
  // Update question count
  state.questionsShown += phaseQuestions.length;
  
  // Calculate the actual total questions answered/shown for user
  const totalQuestionsAnswered = userProfile.totalQuestionsAnswered || 0;
  const totalInteractions = Object.keys(userProfile.interactions || {}).length;
  const isDuringColdStart = !userProfile.coldStartComplete && totalQuestionsAnswered < 20;
  
  // Add explanations for each question
  phaseQuestions.forEach(question => {
    explanations[question.id] = [];
    
    // Add explanation about the question's selection
    if (state.isExplorationQuestion.has(question.id)) {
      const weight = state.topicWeights.get(question.topic)?.toFixed(2) || '0.50';
      explanations[question.id].push(`Exploration question from ${question.topic} (weight: ${weight})`);
    } else {
      const weight = state.topicWeights.get(question.topic)?.toFixed(2) || '0.50';
      explanations[question.id].push(`Preferred question from ${question.topic} (weight: ${weight})`);
    }
    
    // Add explanation about the phase based on the ACTUAL user progress, not forced phase
    // This is the key fix - we need to use the user's progress to determine the phase explanation
    if (isDuringColdStart) {
      if (totalQuestionsAnswered < 5) {
        explanations[question.id].push(`Initial exploration phase (questions 1-5)`);
        explanations[question.id].push(`Selection mechanism: initial exploration`);
      } else if (totalQuestionsAnswered < 20) {
        explanations[question.id].push(`Branching phase (questions 6-20)`);
        
        // Add the specific branching phase selection mechanism
        if (state.isExplorationQuestion.has(question.id)) {
          explanations[question.id].push(`Selection mechanism: branching-exploration`);
        } else {
          explanations[question.id].push(`Selection mechanism: branching-preference`);
        }
      }
    } else {
      // Past cold start - show normal phase explanation
      explanations[question.id].push(`Normal phase (beyond question 20)`);
      explanations[question.id].push(`Selection mechanism: normal-personalization`);
    }
    
    // If this is a forced phase, add explanation about why
    if (forcedPhase) {
      if (forcedPhase === 'exploration' && state.questionsShown >= 5) {
        explanations[question.id].push(`Added at cold start checkpoint position ${state.questionsShown}`);
        explanations[question.id].push(`Selection mechanism: forced-exploration`);
      } else if (forcedPhase === 'branching' && state.questionsShown >= 5) { 
        explanations[question.id].push(`Added at cold start checkpoint position ${state.questionsShown}`);
        explanations[question.id].push(`Selection mechanism: forced-branching`);
      } else if (forcedPhase === 'normal' && isDuringColdStart) {
        explanations[question.id].push(`Added after skip (during cold start)`);
        explanations[question.id].push(`Selection mechanism: normal-fallback`);
      } else if (forcedPhase === 'normal' && !isDuringColdStart) {
        explanations[question.id].push(`Added after skip (past cold start)`);
        explanations[question.id].push(`Selection mechanism: normal-fallback`);
      }
    }
  });
  
  // Update the state in the user profile
  userProfile.coldStartState = serializeColdStartState(state);
  
  return {
    items: phaseQuestions,
    state: state,
    explanations: explanations
  };
}

// Update the reconstructStateFromUserProfile function to use position-based phase detection
function reconstructStateFromUserProfile(
  userProfile: UserProfile,
  allQuestions: FeedItem[]
): ColdStartState {
  console.log("===== Reconstructing Cold Start State =====");
  const state = initColdStartState();
  
  // Calculate the number of questions the user has interacted with
  const interactionCount = Object.keys(userProfile.interactions || {}).length;
  console.log(`Found ${interactionCount} total interactions in user profile`);
  
  // Track the current position (1-indexed)
  const currentPosition = interactionCount + 1;
  
  // Set the phase based on the position rather than just interaction count
  if (currentPosition < 5) {
    state.phase = 'exploration';
  } else if (currentPosition < 20) {
    state.phase = 'branching';
  } else {
    state.phase = 'normal';
  }
  console.log(`Set phase to ${state.phase} based on position ${currentPosition} (${interactionCount} past interactions)`);
  
  state.questionsShown = interactionCount;
  
  // Track skipped and answered topics separately
  const skippedTopics = new Set<string>();
  const answeredTopics = new Set<string>();
  
  console.log(`Processing ${Object.keys(userProfile.interactions || {}).length} past interactions`);
  
  // Process past interactions to update the state
  Object.entries(userProfile.interactions || {}).forEach(([questionId, interaction]) => {
    // Find the question in allQuestions
    const question = allQuestions.find(q => q.id === questionId);
    if (!question) {
      console.log(`Question ${questionId} not found in allQuestions, skipping`);
      return;
    }
    
    // Mark question as shown
    state.shownQuestionIds.add(questionId);
    
    // Track the topic
    const topic = question.topic;
    console.log(`Processing interaction for question ${questionId} (${topic}): ${JSON.stringify(interaction)}`);
    
    // Add to recent topics if not already there
    if (!state.recentTopics.includes(topic)) {
      state.recentTopics.unshift(topic);
      if (state.recentTopics.length > 5) {
        state.recentTopics.pop();
      }
    }
    
    // Process interaction data
    if (interaction.wasCorrect === true) {
      // Correct answer - this topic should be in topicsShown
      const count = state.correctAnsweredByTopic.get(topic) || 0;
      state.correctAnsweredByTopic.set(topic, count + 1);
      state.topicsShown.add(topic);
      answeredTopics.add(topic);
      console.log(`Topic ${topic} was answered correctly (count: ${count + 1}) - added to topicsShown`);
    } else if (interaction.wasCorrect === false) {
      // Wrong answer - this topic should be in topicsShown
      const count = state.wrongAnsweredByTopic.get(topic) || 0;
      state.wrongAnsweredByTopic.set(topic, count + 1);
      state.topicsShown.add(topic);
      answeredTopics.add(topic);
      console.log(`Topic ${topic} was answered incorrectly (count: ${count + 1}) - added to topicsShown`);
    } else if (interaction.wasSkipped) {
      // Skipped question - this topic should NOT be in topicsShown
      // unless the user has also answered a question from this topic
      const count = state.skippedByTopic.get(topic) || 0;
      state.skippedByTopic.set(topic, count + 1);
      skippedTopics.add(topic);
      console.log(`Topic ${topic} was skipped (count: ${count + 1})`);
      
      // Only add to topicsShown if also answered (this is the key fix)
      if (answeredTopics.has(topic)) {
        console.log(`Topic ${topic} was skipped but also has answers - adding to topicsShown`);
        state.topicsShown.add(topic);
      } else {
        // Make sure skipped-only topics are NOT in topicsShown
        if (state.topicsShown.has(topic)) {
          console.log(`FIXING INCONSISTENCY: Topic ${topic} was only skipped but was in topicsShown - removing it`);
          state.topicsShown.delete(topic);
        }
      }
    }
  });
  
  // Log the state information after reconstruction
  console.log(`Reconstructed state summary:`);
  console.log(`Phase: ${state.phase}`);
  console.log(`Questions shown: ${state.questionsShown}`);
  console.log(`Topics shown (only answered topics): ${Array.from(state.topicsShown).join(', ')}`);
  console.log(`Skipped-only topics (not counted as shown): ${Array.from(skippedTopics).filter(t => !answeredTopics.has(t)).join(', ')}`);
  console.log(`Topics with answers: ${Array.from(answeredTopics).join(', ')}`);
  console.log(`Skipped topics: ${Array.from(state.skippedByTopic.entries()).map(([topic, count]) => `${topic}(${count})`).join(', ')}`);
  console.log(`Answered topics: ${Array.from(state.correctAnsweredByTopic.entries()).map(([topic, count]) => `${topic}(${count})`).join(', ')} and ${Array.from(state.wrongAnsweredByTopic.entries()).map(([topic, count]) => `${topic}(${count})`).join(', ')}`);
  console.log("============================================");
  
  return state;
}

// Helper function to ensure a topic has a default weight in the in-session state
function ensureTopicHasDefaultWeight(state: ColdStartState, userProfile: UserProfile, topic: string): void {
  // If we already have a weight for this topic in the in-session state, don't overwrite it
  if (state.topicWeights.has(topic)) {
    return;
  }
  
  // Try to get the weight from the user profile
  const topicWeight = userProfile.topics?.[topic]?.weight;
  
  // Set the weight to profile value or default (0.5)
  state.topicWeights.set(topic, topicWeight !== undefined ? topicWeight : 0.5);
  
  console.log(`Set default weight for topic ${topic}: ${state.topicWeights.get(topic)?.toFixed(2)}`);
} 