import { FeedItem } from './triviaService';
import { getColdStartFeed } from './coldStartStrategy';
import { WeightChange } from '../types/trackerTypes';
import { ALL_TOPICS } from '../constants/topics';

// Types for user interaction metrics
export type QuestionInteraction = {
  timeSpent: number;
  wasCorrect?: boolean;
  wasSkipped: boolean;
  viewedAt: number; // timestamp
};

// Topic tree node types
export type TopicBranch = {
  weight: number;
  lastViewed?: number;
};

export type SubTopic = {
  weight: number;
  branches: { [branchName: string]: TopicBranch };
  lastViewed?: number;
};

export type RootTopic = {
  weight: number;
  subtopics: { [subtopicName: string]: SubTopic };
  lastViewed?: number;
};

// User profile including topic preferences
export type UserProfile = {
  topics: { [topicName: string]: RootTopic };
  interactions: { [questionId: string]: QuestionInteraction };
  lastRefreshed: number;
  coldStartComplete?: boolean; // Flag to indicate if cold start is complete
  totalQuestionsAnswered?: number; // Track total questions answered
  coldStartState?: any; // Track cold start state for persistence
  lastQuestionAnswered?: {
    questionId: string;
    answer?: string;
    correct?: boolean;
    skipped?: boolean;
    topic: string;
  }; // Track the last question answered for cold start algorithm
};

const DEFAULT_TOPIC_WEIGHT = 0.5;
const DEFAULT_SUBTOPIC_WEIGHT = 0.5;
const DEFAULT_BRANCH_WEIGHT = 0.5;

// Weight factors for scoring algorithm
const WEIGHTS = {
  accuracy: 0.25,
  timeSpent: 0.15,
  skipPenalty: -0.2,
  topicAffinity: 0.3,
  novelty: 0.15,
  cooldown: 0.1,
  
  // Decay rates (per day)
  weightDecay: 0.05,
  
  // Time thresholds (ms)
  fastAnswerThreshold: 3000, // 3 seconds
  longAnswerThreshold: 15000, // 15 seconds
};

// Exploration percentages
const EXPLORATION = {
  newRootTopics: 0.05, // 5%
  newSubtopics: 0.10, // 10%
  newBranches: 0.15, // 15%
};

/**
 * Calculates the score for a question based on the user profile and interaction history
 */
export function calculateQuestionScore(
  question: FeedItem,
  userProfile: UserProfile
): { score: number; explanations: string[] } {
  const explanations: string[] = [];
  let score = 0;
  
  // Get topic structure from question
  const topic = question.topic;
  const subtopic = question.tags?.[0] || 'General';
  const branch = question.tags?.[1] || 'General';
  
  // 1. Topic Affinity
  const topicWeight = userProfile.topics[topic]?.weight || DEFAULT_TOPIC_WEIGHT;
  const subtopicWeight = userProfile.topics[topic]?.subtopics[subtopic]?.weight || DEFAULT_SUBTOPIC_WEIGHT;
  const branchWeight = userProfile.topics[topic]?.subtopics[subtopic]?.branches[branch]?.weight || DEFAULT_BRANCH_WEIGHT;
  
  const topicAffinity = (topicWeight + subtopicWeight + branchWeight) / 3;
  score += topicAffinity * WEIGHTS.topicAffinity;
  explanations.push(`Topic affinity: ${topicAffinity.toFixed(2)} (${topic}/${subtopic}/${branch})`);
  
  // 2. Previous interaction with this question
  const interaction = userProfile.interactions[question.id];
  if (interaction) {
    // 2.1 Accuracy component
    if (interaction.wasCorrect !== undefined) {
      const accuracyScore = interaction.wasCorrect ? WEIGHTS.accuracy : -WEIGHTS.accuracy;
      score += accuracyScore;
      explanations.push(`Previous accuracy: ${interaction.wasCorrect ? '+' : '-'}${WEIGHTS.accuracy.toFixed(2)}`);
    }
    
    // 2.2 Time spent component
    if (interaction.timeSpent !== undefined) {
      let timeScore = 0;
      if (interaction.timeSpent < WEIGHTS.fastAnswerThreshold) {
        timeScore = WEIGHTS.timeSpent; // Fast answer = positive
      } else if (interaction.timeSpent > WEIGHTS.longAnswerThreshold) {
        timeScore = -WEIGHTS.timeSpent; // Very slow answer = negative
      }
      score += timeScore;
      explanations.push(`Time spent: ${timeScore.toFixed(2)} (${interaction.timeSpent}ms)`);
    }
    
    // 2.3 Skip penalty
    if (interaction.wasSkipped) {
      score += WEIGHTS.skipPenalty;
      explanations.push(`Skip penalty: ${WEIGHTS.skipPenalty.toFixed(2)}`);
    }
    
    // 2.4 Novelty/cooldown bonus
    const daysSinceLastView = (Date.now() - interaction.viewedAt) / (1000 * 60 * 60 * 24);
    const cooldownBonus = Math.min(daysSinceLastView * WEIGHTS.cooldown, 0.5);
    score += cooldownBonus;
    explanations.push(`Cooldown bonus: +${cooldownBonus.toFixed(2)} (${daysSinceLastView.toFixed(1)} days)`);
  } else {
    // 3. Novelty bonus for unseen questions
    score += WEIGHTS.novelty;
    explanations.push(`Novelty bonus: +${WEIGHTS.novelty.toFixed(2)} (never seen)`);
  }
  
  return { score, explanations };
}

/**
 * Updates user profile based on interaction with a question
 */
export function updateUserProfile(
  userProfile: UserProfile,
  questionId: string,
  interaction: Partial<QuestionInteraction>,
  question: FeedItem
): { updatedProfile: UserProfile; weightChange: WeightChange | null } {
  // Use JSON parse/stringify for a full deep clone to avoid extensibility issues
  const updatedProfile = JSON.parse(JSON.stringify(userProfile)) as UserProfile;
  
  // 1. Update interaction history
  const currentTime = Date.now();
  const existingInteraction = updatedProfile.interactions[questionId] || {
    timeSpent: 0,
    wasSkipped: false,
    viewedAt: currentTime
  };
  
  updatedProfile.interactions[questionId] = {
    ...existingInteraction,
    ...interaction,
    viewedAt: currentTime
  };
  
  // Track total questions answered
  if (interaction.wasCorrect !== undefined) {
    updatedProfile.totalQuestionsAnswered = (updatedProfile.totalQuestionsAnswered || 0) + 1;
  }
  
  // 2. Update topic weights based on interaction
  const topic = question.topic;
  const subtopic = question.tags?.[0] || 'General';
  const branch = question.tags?.[1] || 'General';
  
  // Ensure topic tree structure exists - use explicit default values
  if (!updatedProfile.topics[topic]) {
    console.log(`[WEIGHT UPDATE] Creating new topic ${topic} with default weight ${DEFAULT_TOPIC_WEIGHT}`);
    updatedProfile.topics[topic] = {
      weight: DEFAULT_TOPIC_WEIGHT,
      subtopics: {},
      lastViewed: currentTime
    };
  }
  
  if (!updatedProfile.topics[topic].subtopics[subtopic]) {
    console.log(`[WEIGHT UPDATE] Creating new subtopic ${subtopic} with default weight ${DEFAULT_SUBTOPIC_WEIGHT}`);
    updatedProfile.topics[topic].subtopics[subtopic] = {
      weight: DEFAULT_SUBTOPIC_WEIGHT,
      branches: {},
      lastViewed: currentTime
    };
  }
  
  if (!updatedProfile.topics[topic].subtopics[subtopic].branches[branch]) {
    console.log(`[WEIGHT UPDATE] Creating new branch ${branch} with default weight ${DEFAULT_BRANCH_WEIGHT}`);
    updatedProfile.topics[topic].subtopics[subtopic].branches[branch] = {
      weight: DEFAULT_BRANCH_WEIGHT,
      lastViewed: currentTime
    };
  }
  
  // Update weights
  const topicNode = updatedProfile.topics[topic];
  const subtopicNode = topicNode.subtopics[subtopic];
  const branchNode = subtopicNode.branches[branch];
  
  // Store old weights before updating - ensure we're using the actual current values
  const oldWeights = {
    topicWeight: topicNode.weight,
    subtopicWeight: subtopicNode.weight,
    branchWeight: branchNode.weight
  };
  
  // Log the actual values being used
  console.log(`[WEIGHT UPDATE] Initial weights for ${questionId}: topic=${oldWeights.topicWeight.toFixed(2)}, subtopic=${oldWeights.subtopicWeight.toFixed(2)}, branch=${oldWeights.branchWeight.toFixed(2)}`);
  
  // Check for suspiciously non-default weights in a new user profile
  if (Object.keys(updatedProfile.interactions).length <= 1) {
    if (Math.abs(oldWeights.topicWeight - DEFAULT_TOPIC_WEIGHT) > 0.01) {
      console.warn(`[WEIGHT UPDATE] Warning: Topic weight ${oldWeights.topicWeight.toFixed(2)} is not default ${DEFAULT_TOPIC_WEIGHT.toFixed(2)} for a new user profile. Resetting to default.`);
      topicNode.weight = DEFAULT_TOPIC_WEIGHT;
      oldWeights.topicWeight = DEFAULT_TOPIC_WEIGHT;
    }
    if (Math.abs(oldWeights.subtopicWeight - DEFAULT_SUBTOPIC_WEIGHT) > 0.01) {
      console.warn(`[WEIGHT UPDATE] Warning: Subtopic weight ${oldWeights.subtopicWeight.toFixed(2)} is not default ${DEFAULT_SUBTOPIC_WEIGHT.toFixed(2)} for a new user profile. Resetting to default.`);
      subtopicNode.weight = DEFAULT_SUBTOPIC_WEIGHT;
      oldWeights.subtopicWeight = DEFAULT_SUBTOPIC_WEIGHT;
    }
    if (Math.abs(oldWeights.branchWeight - DEFAULT_BRANCH_WEIGHT) > 0.01) {
      console.warn(`[WEIGHT UPDATE] Warning: Branch weight ${oldWeights.branchWeight.toFixed(2)} is not default ${DEFAULT_BRANCH_WEIGHT.toFixed(2)} for a new user profile. Resetting to default.`);
      branchNode.weight = DEFAULT_BRANCH_WEIGHT;
      oldWeights.branchWeight = DEFAULT_BRANCH_WEIGHT;
    }
  }
  
  // Update timestamps
  topicNode.lastViewed = currentTime;
  subtopicNode.lastViewed = currentTime;
  branchNode.lastViewed = currentTime;
  
  // Determine interaction type
  let interactionType: 'correct' | 'incorrect' | 'skipped' = 'skipped';
  if (interaction.wasCorrect === true) {
    interactionType = 'correct';
  } else if (interaction.wasCorrect === false) {
    interactionType = 'incorrect';
  }
  
  // Check if this question was previously skipped
  const wasSkippedPreviously = existingInteraction.wasSkipped === true;
  
  // Define compensations for previously skipped questions that are now being answered
  let skipCompensation = {
    applied: false,
    topicCompensation: 0,
    subtopicCompensation: 0,
    branchCompensation: 0
  };
  
  // If question was correct, increase weights
  if (interaction.wasCorrect) {
    // Significant weight increase for correct answers (per new requirements)
    topicNode.weight = Math.min(1.0, topicNode.weight + 0.1);
    subtopicNode.weight = Math.min(1.0, subtopicNode.weight + 0.15);
    branchNode.weight = Math.min(1.0, branchNode.weight + 0.2);
    
    // If previously skipped, compensate for the previous skip penalty
    if (wasSkippedPreviously) {
      skipCompensation.applied = true;
      skipCompensation.topicCompensation = 0.05; // Match the skip penalty
      skipCompensation.subtopicCompensation = 0.07;
      skipCompensation.branchCompensation = 0.1;
      
      // Apply compensations (with upper limit of 1.0)
      topicNode.weight = Math.min(1.0, topicNode.weight + skipCompensation.topicCompensation);
      subtopicNode.weight = Math.min(1.0, subtopicNode.weight + skipCompensation.subtopicCompensation);
      branchNode.weight = Math.min(1.0, branchNode.weight + skipCompensation.branchCompensation);
    }
  } 
  // If question was answered incorrectly, moderate increase (user still engaged)
  else if (interaction.wasCorrect === false) {
    // Moderate weight increase for incorrect answers (per new requirements)
    topicNode.weight = Math.min(1.0, topicNode.weight + 0.05);
    subtopicNode.weight = Math.min(1.0, subtopicNode.weight + 0.07);
    branchNode.weight = Math.min(1.0, branchNode.weight + 0.1);
    
    // If previously skipped, add compensation (they engaged but got it wrong)
    if (wasSkippedPreviously) {
      skipCompensation.applied = true;
      skipCompensation.topicCompensation = 0.03;
      skipCompensation.subtopicCompensation = 0.04;
      skipCompensation.branchCompensation = 0.05;
      
      // Apply compensations (with upper limit of 1.0)
      topicNode.weight = Math.min(1.0, topicNode.weight + skipCompensation.topicCompensation);
      subtopicNode.weight = Math.min(1.0, subtopicNode.weight + skipCompensation.subtopicCompensation);
      branchNode.weight = Math.min(1.0, branchNode.weight + skipCompensation.branchCompensation);
    }
  }
  // If question was skipped, decrease weights (per new requirements)
  else if (interaction.wasSkipped) {
    console.log(`[WEIGHT UPDATE] Reducing weights for skipped question ${questionId} in topic ${topic}`);
    console.log(`[WEIGHT UPDATE] Before skip: topic=${topicNode.weight.toFixed(4)}, subtopic=${subtopicNode.weight.toFixed(4)}, branch=${branchNode.weight.toFixed(4)}`);
    
    // Store values before changes
    const prevTopicWeight = topicNode.weight;
    const prevSubtopicWeight = subtopicNode.weight;
    const prevBranchWeight = branchNode.weight;
    
    // Apply weight reductions - using explicit calculation to avoid precision issues
    const newTopicWeight = Math.max(0.1, topicNode.weight - 0.05);
    const newSubtopicWeight = Math.max(0.1, subtopicNode.weight - 0.07);
    const newBranchWeight = Math.max(0.1, branchNode.weight - 0.1);
    
    // Force explicit numeric assignment
    topicNode.weight = Number(newTopicWeight);
    subtopicNode.weight = Number(newSubtopicWeight);
    branchNode.weight = Number(newBranchWeight);
    
    // Double-check and log if weights remained unchanged
    if (Math.abs(topicNode.weight - prevTopicWeight) < 0.001) {
      console.warn(`[WEIGHT UPDATE] Warning: Topic weight didn't change for ${topic}. Before: ${prevTopicWeight}, After: ${topicNode.weight}`);
      
      // Force the change if it didn't take effect
      if (Math.abs(prevTopicWeight - 0.5) < 0.001) {
        topicNode.weight = 0.45; // Force to expected value if it was default
        console.log(`[WEIGHT UPDATE] Force-applied topic weight change: ${topicNode.weight.toFixed(4)}`);
      }
    }
    
    if (Math.abs(subtopicNode.weight - prevSubtopicWeight) < 0.001) {
      console.warn(`[WEIGHT UPDATE] Warning: Subtopic weight didn't change for ${subtopic}. Before: ${prevSubtopicWeight}, After: ${subtopicNode.weight}`);
      
      // Force the change if it didn't take effect
      if (Math.abs(prevSubtopicWeight - 0.5) < 0.001) {
        subtopicNode.weight = 0.43; // Force to expected value if it was default
        console.log(`[WEIGHT UPDATE] Force-applied subtopic weight change: ${subtopicNode.weight.toFixed(4)}`);
      }
    }
    
    if (Math.abs(branchNode.weight - prevBranchWeight) < 0.001) {
      console.warn(`[WEIGHT UPDATE] Warning: Branch weight didn't change for ${branch}. Before: ${prevBranchWeight}, After: ${branchNode.weight}`);
      
      // Force the change if it didn't take effect
      if (Math.abs(prevBranchWeight - 0.5) < 0.001) {
        branchNode.weight = 0.4; // Force to expected value if it was default
        console.log(`[WEIGHT UPDATE] Force-applied branch weight change: ${branchNode.weight.toFixed(4)}`);
      }
    }
    
    // Calculate changes for logging
    const topicChange = topicNode.weight - prevTopicWeight;
    const subtopicChange = subtopicNode.weight - prevSubtopicWeight;
    const branchChange = branchNode.weight - prevBranchWeight;
    
    console.log(`[WEIGHT UPDATE] After skip: topic=${topicNode.weight.toFixed(4)}, subtopic=${subtopicNode.weight.toFixed(4)}, branch=${branchNode.weight.toFixed(4)}`);
    console.log(`[WEIGHT UPDATE] Changes: topic=${topicChange.toFixed(4)}, subtopic=${subtopicChange.toFixed(4)}, branch=${branchChange.toFixed(4)}`);
  }
  
  // Create weight change record - make sure it uses real weight values
  const weightChange: WeightChange = {
    timestamp: currentTime,
    questionId,
    interactionType,
    questionText: question.question || `Question ${questionId.substring(0, 5)}...`,
    topic: topic,
    subtopic,
    branch,
    oldWeights: {
      topicWeight: oldWeights.topicWeight,
      subtopicWeight: oldWeights.subtopicWeight,
      branchWeight: oldWeights.branchWeight
    },
    newWeights: {
      // Ensure these are numeric values
      topicWeight: Number(topicNode.weight),
      subtopicWeight: Number(subtopicNode.weight),
      branchWeight: Number(branchNode.weight)
    },
    // Add skip compensation information if applicable
    skipCompensation: skipCompensation.applied ? skipCompensation : undefined
  };
  
  // Log the weight change record
  console.log(`[WEIGHT UPDATE] Created weight change record:
    Old weights: topic=${weightChange.oldWeights.topicWeight.toFixed(2)}, subtopic=${weightChange.oldWeights.subtopicWeight?.toFixed(2) || 'N/A'}, branch=${weightChange.oldWeights.branchWeight?.toFixed(2) || 'N/A'}
    New weights: topic=${weightChange.newWeights.topicWeight.toFixed(2)}, subtopic=${weightChange.newWeights.subtopicWeight?.toFixed(2) || 'N/A'}, branch=${weightChange.newWeights.branchWeight?.toFixed(2) || 'N/A'}
  `);
  
  return { updatedProfile, weightChange };
}

/**
 * Applies weight decay to inactive topics/subtopics/branches
 */
export function applyWeightDecay(userProfile: UserProfile): UserProfile {
  const currentTime = Date.now();
  const daysSinceLastRefresh = (currentTime - userProfile.lastRefreshed) / (1000 * 60 * 60 * 24);
  
  // Only apply decay if it's been at least a day
  if (daysSinceLastRefresh < 1) {
    return userProfile;
  }
  
  const decayFactor = daysSinceLastRefresh * WEIGHTS.weightDecay;
  const updatedProfile = { ...userProfile, lastRefreshed: currentTime };
  
  // Apply decay to all topics
  Object.keys(updatedProfile.topics).forEach(topicName => {
    const topic = updatedProfile.topics[topicName];
    
    // Decay topic weight
    const daysSinceTopicViewed = (currentTime - (topic.lastViewed || 0)) / (1000 * 60 * 60 * 24);
    if (daysSinceTopicViewed > 1) {
      topic.weight = Math.max(0.1, topic.weight - decayFactor);
    }
    
    // Decay subtopics
    Object.keys(topic.subtopics).forEach(subtopicName => {
      const subtopic = topic.subtopics[subtopicName];
      
      // Decay subtopic weight
      const daysSinceSubtopicViewed = (currentTime - (subtopic.lastViewed || 0)) / (1000 * 60 * 60 * 24);
      if (daysSinceSubtopicViewed > 1) {
        subtopic.weight = Math.max(0.1, subtopic.weight - decayFactor);
      }
      
      // Decay branches
      Object.keys(subtopic.branches).forEach(branchName => {
        const branch = subtopic.branches[branchName];
        
        // Decay branch weight
        const daysSinceBranchViewed = (currentTime - (branch.lastViewed || 0)) / (1000 * 60 * 60 * 24);
        if (daysSinceBranchViewed > 1) {
          branch.weight = Math.max(0.1, branch.weight - decayFactor);
        }
      });
    });
  });
  
  return updatedProfile;
}

/**
 * Selects feed items based on personalization logic
 * May include exploration items to ensure diversity
 */
export function getPersonalizedFeed(
  allItems: FeedItem[],
  userProfile: UserProfile,
  count: number = 20
): { items: FeedItem[], explanations: { [questionId: string]: string[] } } {
  // Check if we should use cold start strategy
  const totalInteractions = Object.keys(userProfile.interactions).length;
  const totalQuestionsAnswered = userProfile.totalQuestionsAnswered || 0;
  
  // Use cold start strategy if user has interacted with fewer than 20 questions
  // or if coldStartComplete flag is not set to true
  if (totalInteractions < 20 || totalQuestionsAnswered < 20 || !userProfile.coldStartComplete) {
    console.log('Using Cold Start Strategy for feed personalization');
    const coldStartResult = getColdStartFeed(allItems, userProfile);
    
    // If we're in the final phase, mark cold start as complete
    if (coldStartResult.state.phase === 'normal' && coldStartResult.state.questionsShown >= 20) {
      // This will be saved to userProfile when updateUserProfile is called
      userProfile.coldStartComplete = true;
    }
    
    // Ensure no duplicate items by ID
    const seen = new Set<string>();
    const uniqueItems: FeedItem[] = [];
    
    // Build a unique items array
    for (const item of coldStartResult.items) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        uniqueItems.push(item);
      }
    }
    
    // Rebuild explanations object for unique items only
    const uniqueExplanations: { [questionId: string]: string[] } = {};
    uniqueItems.forEach(item => {
      if (coldStartResult.explanations[item.id]) {
        uniqueExplanations[item.id] = coldStartResult.explanations[item.id];
      }
    });
    
    // Use string concatenation for logging
    console.log("Cold start feed: " + coldStartResult.items.length + " items, " + uniqueItems.length + " after removing duplicates");
    
    return {
      items: uniqueItems,
      explanations: uniqueExplanations
    };
  }
  
  // Otherwise, continue with normal personalization logic
  console.log('Using Normal Personalization Strategy for feed');
  
  // Apply weight decay to inactive topics/subtopics/branches
  const updatedProfile = applyWeightDecay(userProfile);
  
  // Score all items
  const scoredItems = allItems.map(item => {
    const { score, explanations } = calculateQuestionScore(item, updatedProfile);
    return { item, score, explanations };
  });
  
  // Split into categories:
  // 1. Items from entirely new root topics (for exploration)
  // 2. Items from known topics but new subtopics (for subtopic exploration)
  // 3. Items from known subtopics but new branches (for branch exploration)
  // 4. Items from known branches (for personalized selection)
  
  const knownTopics = new Set(Object.keys(updatedProfile.topics));
  const knownSubtopics = new Map<string, Set<string>>();
  const knownBranches = new Map<string, Map<string, Set<string>>>();
  
  // Build known subtopics and branches lookup maps
  Object.keys(updatedProfile.topics).forEach(topic => {
    knownSubtopics.set(topic, new Set(Object.keys(updatedProfile.topics[topic].subtopics)));
    knownBranches.set(topic, new Map());
    
    Object.keys(updatedProfile.topics[topic].subtopics).forEach(subtopic => {
      const branches = new Set(Object.keys(updatedProfile.topics[topic].subtopics[subtopic].branches));
      knownBranches.get(topic)?.set(subtopic, branches);
    });
  });
  
  // Categorize items
  const newTopicItems: typeof scoredItems = [];
  const newSubtopicItems: typeof scoredItems = [];
  const newBranchItems: typeof scoredItems = [];
  const knownItems: typeof scoredItems = [];
  
  scoredItems.forEach(scoredItem => {
    const { item } = scoredItem;
    const topic = item.topic;
    const subtopic = item.tags?.[0] || 'General';
    const branch = item.tags?.[1] || 'General';
    
    if (!knownTopics.has(topic)) {
      newTopicItems.push(scoredItem);
    } else if (!knownSubtopics.get(topic)?.has(subtopic)) {
      newSubtopicItems.push(scoredItem);
    } else if (!knownBranches.get(topic)?.get(subtopic)?.has(branch)) {
      newBranchItems.push(scoredItem);
    } else {
      knownItems.push(scoredItem);
    }
  });
  
  // Sort each category by score
  newTopicItems.sort((a, b) => b.score - a.score);
  newSubtopicItems.sort((a, b) => b.score - a.score);
  newBranchItems.sort((a, b) => b.score - a.score);
  knownItems.sort((a, b) => b.score - a.score);
  
  // Calculate item counts based on the new 70/30 split for normal state
  const preferredCount = Math.floor(count * 0.7); // 70% from preferred topics
  const explorationCount = count - preferredCount; // 30% for exploration
  
  // Combine the categories with explanations
  const selectedItems: FeedItem[] = [];
  const explanations: { [questionId: string]: string[] } = {};
  
  // Use a Set to track IDs we've already added to prevent duplicates
  const addedItemIds = new Set<string>();
  
  // Use a Set to track topics already used for exploration questions
  const usedExplorationTopics = new Set<string>();
  
  // Track whether each question is an exploration question
  const isExplorationQuestion = new Set<string>();
  
  // Helper function to add item only if not already added
  const addItemIfUnique = (item: FeedItem, itemExplanations: string[], isExploration: boolean = false) => {
    if (!addedItemIds.has(item.id)) {
      // For exploration questions, enforce topic diversity
      if (isExploration) {
        // Skip if we've already used this topic for exploration
        if (usedExplorationTopics.has(item.topic)) {
          return false;
        }
        usedExplorationTopics.add(item.topic);
        isExplorationQuestion.add(item.id);
        
        // Add exploration marker to explanations
        if (!itemExplanations.some(exp => exp.includes('Exploration:'))) {
          itemExplanations.push('Exploration: Discovering new content');
        }
      } else {
        // Add preferred marker to explanations
        if (!itemExplanations.some(exp => exp.includes('Preferred:'))) {
          itemExplanations.push('Preferred: Based on your interests');
        }
      }
      
      selectedItems.push(item);
      explanations[item.id] = itemExplanations;
      addedItemIds.add(item.id);
      return true;
    }
    return false;
  };
  
  // Step 1: Add preferred items from known topics (70% of total)
  let i = 0;
  let added = 0;
  
  // Track used preferred topics for diversity
  const usedPreferredTopics = new Set<string>();
  
  // First, try to add items from high-weight topics (weight > 0.5)
  while (added < preferredCount && i < knownItems.length) {
    const { item, explanations: itemExplanations } = knownItems[i];
    
    // Get topic weight
    const topicWeight = updatedProfile.topics[item.topic]?.weight || 0.5;
    
    // If weight is high enough and we haven't used this topic too much
    if (topicWeight > 0.5 && (!usedPreferredTopics.has(item.topic) || usedPreferredTopics.size >= 3)) {
      if (addItemIfUnique(item, [...itemExplanations], false)) {
      added++;
        usedPreferredTopics.add(item.topic);
      }
    }
    i++;
  }
  
  // If we haven't filled the preferred quota, add any known items
  if (added < preferredCount) {
    i = 0; // Reset counter to start from beginning
    while (added < preferredCount && i < knownItems.length) {
      const { item, explanations: itemExplanations } = knownItems[i];
      if (addItemIfUnique(item, [...itemExplanations], false)) {
        added++;
      }
      i++;
    }
  }
  
  // Step 2: Add exploration items (30% of total)
  // - First try new branches from known subtopics
  i = 0;
  added = 0;
  while (added < explorationCount && i < newBranchItems.length) {
    const { item, explanations: itemExplanations } = newBranchItems[i];
    if (addItemIfUnique(item, [...itemExplanations, 'Exploration: New branch within known subtopic'], true)) {
      added++;
    }
    i++;
  }
  
  // - Then try new subtopics from known topics
  i = 0;
  while (added < explorationCount && i < newSubtopicItems.length) {
    const { item, explanations: itemExplanations } = newSubtopicItems[i];
    if (addItemIfUnique(item, [...itemExplanations, 'Exploration: New subtopic within known topic'], true)) {
      added++;
    }
    i++;
  }
  
  // - Finally try entirely new topics
  i = 0;
  while (added < explorationCount && i < newTopicItems.length) {
    const { item, explanations: itemExplanations } = newTopicItems[i];
    if (addItemIfUnique(item, [...itemExplanations, 'Exploration: Entirely new topic'], true)) {
      added++;
    }
    i++;
  }
  
  // If we still need more items, fill with any remaining known items
  if (selectedItems.length < count) {
    const remainingNeeded = count - selectedItems.length;
    // Try remaining known items first
    i = 0;
    added = 0;
    while (added < remainingNeeded && i < knownItems.length) {
      const { item, explanations: itemExplanations } = knownItems[i];
      if (!addedItemIds.has(item.id)) {
      if (addItemIfUnique(item, itemExplanations, false)) {
          added++;
        }
      }
      i++;
    }
    
    // If still not enough, try any remaining item not yet used
    const allRemainingItems = [...newTopicItems, ...newSubtopicItems, ...newBranchItems]
      .filter(({ item }) => !addedItemIds.has(item.id));
    
    i = 0;
    while (added < remainingNeeded && i < allRemainingItems.length) {
      const { item, explanations: itemExplanations } = allRemainingItems[i];
      if (addItemIfUnique(item, itemExplanations, true)) {
        added++;
      }
      i++;
    }
  }
  
  // Double-check for duplicates as a final safety measure
  const seen = new Set<string>();
  const uniqueItems: FeedItem[] = [];
  
  // Build a unique items array
  for (const item of selectedItems) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      uniqueItems.push(item);
    }
  }
  
  // If we removed any duplicates, rebuild the explanations object
  if (uniqueItems.length !== selectedItems.length) {
    // Create a simple logging message with string concatenation
    console.log("Removed " + (selectedItems.length - uniqueItems.length) + " duplicate items in final check");
    
    // Create a new explanations object with only the unique items
    const finalExplanations: { [questionId: string]: string[] } = {};
    
    for (const item of uniqueItems) {
      if (explanations[item.id]) {
        finalExplanations[item.id] = explanations[item.id];
      }
    }
    
    return { 
      items: uniqueItems, 
      explanations: finalExplanations 
    };
  }
  
  return { 
    items: selectedItems, 
    explanations
  };
}

/**
 * Creates an initial user profile with default weights
 */
export function createInitialUserProfile(): UserProfile {
  // Create empty topics object
  const initialTopics: { [topicName: string]: RootTopic } = {};
  
  // Add all known topics with exact DEFAULT weights (0.5)
  ALL_TOPICS.forEach(topic => {
    initialTopics[topic] = {
      weight: DEFAULT_TOPIC_WEIGHT, // Explicitly use 0.5
      subtopics: {
        'General': {
          weight: DEFAULT_SUBTOPIC_WEIGHT, // Explicitly use 0.5
          branches: {
            'General': {
              weight: DEFAULT_BRANCH_WEIGHT // Explicitly use 0.5
            }
          },
          lastViewed: Date.now()
        }
      },
      lastViewed: Date.now()
    };
  });
  
  return {
    topics: initialTopics,
    interactions: {},
    lastRefreshed: Date.now(),
    coldStartComplete: false,
    totalQuestionsAnswered: 0
  };
} 