/**
 * List of all available topics in the database
 * Used as the initial default list of topics throughout the application
 */
export const ALL_TOPICS = [
  'Ancient History',
  'Art',
  'Arts',
  'Astronomy',
  'Biology',
  'Chemistry',
  'Computers',
  'Countries',
  'Culture',
  'Engineering',
  'Entertainment',
  'Environment',
  'Food',
  'Food and Drink',
  'General Knowledge',
  'Geography',
  'History',
  'Language',
  'Literature',
  'Math',
  'Mathematics',
  'Miscellaneous',
  'Modern History',
  'Music',
  'Nature',
  'Physics',
  'Politics',
  'Pop Culture',
  'Science',
  'Sports',
  'Technology'
];

/**
 * A subset of topics used for the initial exploration phase
 */
export const INITIAL_EXPLORATION_TOPICS = [
  'Music',
  'Science',
  'Arts',
  'Technology',
  'Pop Culture',
  'Literature',
  'Entertainment',
  'Miscellaneous',
  'Geography'
];

/**
 * Map of similar topics that could be treated as the same
 * Keys are the standard topic names, values are arrays of alternative names
 */
export const SIMILAR_TOPICS: Record<string, string[]> = {
  'Arts': ['Art'],
  'Mathematics': ['Math'],
  'Food and Drink': ['Food']
};

/**
 * Returns a standardized topic name, resolving alternatives to their primary name
 * @param topic The topic name to standardize
 * @returns The standardized topic name
 */
export function getStandardizedTopicName(topic: string): string {
  // Check if this topic is an alternative name
  for (const [standard, alternatives] of Object.entries(SIMILAR_TOPICS)) {
    if (alternatives.includes(topic)) {
      return standard;
    }
  }
  
  // If not found in alternatives, return the original
  return topic;
}

/**
 * Creates a map of default weights for all topics
 * @param defaultWeight The default weight to assign (0.5 by default)
 * @returns A map of topics to their default weights
 */
export function getDefaultTopicWeights(defaultWeight: number = 0.5): Map<string, number> {
  const topicWeights = new Map<string, number>();
  
  ALL_TOPICS.forEach(topic => {
    topicWeights.set(topic, defaultWeight);
  });
  
  return topicWeights;
} 