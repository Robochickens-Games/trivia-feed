/**
 * Type definitions for tracker-related data
 */

/**
 * Represents a single interaction with a question
 */
export interface InteractionLog {
  timestamp: number;
  type: 'correct' | 'incorrect' | 'skipped';
  questionId: string;
  timeSpent: number; // in ms
  questionText: string;
}

/**
 * Represents a change in the user's profile
 */
export interface ProfileChange {
  timestamp: number;
  attribute: string;
  oldValue: any;
  newValue: any;
  questionId: string;
}

/**
 * Represents weight factors used in feed item selection
 */
export interface WeightFactors {
  topic: string;
  topicWeight?: number;
  subtopicWeight?: number;
  preferenceReason?: string;
  selectionMethod?: string;
}

/**
 * Represents a change in the feed (item added or removed)
 */
export interface FeedChange {
  timestamp: number;
  type: 'added' | 'removed';
  itemId: string;
  questionText: string;
  explanations: string[];
  weightFactors?: WeightFactors;
}

/**
 * Represents a weight change after user interaction with a question
 */
export interface WeightChange {
  timestamp: number;
  questionId: string;
  interactionType: 'correct' | 'incorrect' | 'skipped';
  questionText?: string;
  topic: string;
  subtopic?: string;
  branch?: string;
  oldWeights: {
    topicWeight: number;
    subtopicWeight?: number;
    branchWeight?: number;
  };
  newWeights: {
    topicWeight: number;
    subtopicWeight?: number;
    branchWeight?: number;
  };
  skipCompensation?: {
    applied: boolean;
    topicCompensation: number;
    subtopicCompensation: number;
    branchCompensation: number;
  };
} 