import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Platform, Animated, Easing, Alert, TextInput } from 'react-native';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { FeedItem } from '../lib/triviaService';
import { dbEventEmitter } from '../lib/syncService';
import { WeightChange } from '../types/trackerTypes';
import { useAuth } from '../context/AuthContext';
import { getDatabaseInfo, attemptDatabaseFix } from '../lib/databaseDebugger';
import { fetchUserProfile } from '../lib/simplifiedSyncService';

interface InteractionLog {
  timestamp: number;
  type: 'correct' | 'incorrect' | 'skipped';
  questionId: string;
  timeSpent: number; // in ms
  questionText: string;
}

interface ProfileChange {
  timestamp: number;
  attribute: string;
  oldValue: any;
  newValue: any;
  questionId: string;
}

interface FeedChange {
  timestamp: number;
  type: 'added' | 'removed';
  itemId: string;
  questionText: string;
  explanations: string[];
  weightFactors?: {
    topic: string;
    topicWeight?: number;
    subtopicWeight?: number;
    preferenceReason?: string;
    selectionMethod?: string;
  };
}

// Database operation log interface
interface DbOperation {
  timestamp: number;
  direction: 'sent' | 'received';
  table: string;
  operation: 'insert' | 'update' | 'select' | 'upsert';
  records: number;
  data: any;
  userId?: string;
  status: 'success' | 'error';
  error?: string;
}

// Add a new interface to track question generation events
interface GeneratorEvent {
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

interface InteractionTrackerProps {
  feedData?: FeedItem[];
  debugEnabled?: boolean;
}

// Add the tableColors function at the top of the file after the interfaces
const tableColors: { [key: string]: string } = {
  'user_profile_data': '#4CAF50',      // Green
  'auth.users': '#607D8B',             // Blue Grey
  'questions': '#E91E63',              // Pink
};

const getOperationColor = (operation: string): string => {
  switch (operation.toLowerCase()) {
    case 'select': return '#2196F3';   // Blue
    case 'insert': return '#4CAF50';   // Green
    case 'update': return '#FF9800';   // Orange
    case 'delete': return '#F44336';   // Red
    case 'upsert': return '#9C27B0';   // Purple
    default: return '#607D8B';         // Blue Grey
  }
};

// Add this new function after the getOperationColor function around line 84
const getActionType = (operation: DbOperation): string => {
  // Check the operation type and data to determine what kind of action is happening
  
  // For user_profile_data operations, look at the specific columns changed
  if (operation.table === 'user_profile_data') {
    if (operation.data) {
      // Check which column is being modified
      if (operation.data.topics) {
        return "Topics";
      } else if (operation.data.interactions) {
        return "Interactions";
      } else if (operation.data.feed_data) {
        return "Feed";
      } else if (operation.data.preferences) {
        return "Preferences";
      } else if (operation.operation === 'select') {
        return "Refreshed";
      }
    }
    return "Profile";
  } 
  
  // For other tables, use table name to determine action type
  else if (operation.table === 'questions') {
    return "Questions";
  } else if (operation.table === 'auth.users') {
    return "Auth";
  } else if (operation.table.includes('feed')) {
    return "Feed";
  } else if (operation.table.includes('interaction')) {
    return "Interactions";
  }
  
  // Default fallback
  return operation.operation === 'select' ? "Refreshed" : "Unknown";
};

export function InteractionTracker({ feedData = [], debugEnabled = false }: InteractionTrackerProps) {
  // Only render the component when debug is enabled
  if (!debugEnabled) {
    return null;
  }

  const [visible, setVisible] = useState(false);
  const [interactions, setInteractions] = useState<InteractionLog[]>([]);
  const [profileChanges, setProfileChanges] = useState<ProfileChange[]>([]);
  const [feedChanges, setFeedChanges] = useState<FeedChange[]>([]);
  const [dbOperations, setDbOperations] = useState<DbOperation[]>([]);
  const [weightChanges, setWeightChanges] = useState<WeightChange[]>([]);
  // Add state for generator events
  const [generatorEvents, setGeneratorEvents] = useState<GeneratorEvent[]>([]);
  const [activeTab, setActiveTab] = useState<'interactions' | 'feed' | 'feedList' | 'dbLog' | 'weights' | 'generator'>('interactions');
  const [expandedExplanations, setExpandedExplanations] = useState<{[id: string]: boolean}>({});
  const [expandedData, setExpandedData] = useState<string | null>(null);
  const [lastWeightUpdateTime, setLastWeightUpdateTime] = useState<number>(0);
  const [isLoadingWeights, setIsLoadingWeights] = useState<boolean>(false);
  const [visibleDbRecords, setVisibleDbRecords] = useState<number>(100); // Default show 100 records
  const [showAllRecords, setShowAllRecords] = useState<boolean>(false); // State to track if showing all records
  const [tableFilter, setTableFilter] = useState<string>(''); // Filter records by table name
  const [summary, setSummary] = useState({
    correct: 0,
    incorrect: 0,
    skipped: 0,
    totalTime: 0,
    avgTime: 0,
  });
  
  // Add state for copy functionality
  const [showCopyUI, setShowCopyUI] = useState(false);
  const [copyText, setCopyText] = useState("");
  
  // Helper to check if a weight value is the default (0.5)
  const isDefaultWeight = (value: number): boolean => {
    // Be more forgiving with the default check - anything close to 0.5 should be considered default
    // This helps with float precision issues and makes the display more consistent
    return Math.abs(value - 0.5) < 0.05;
  };

  // Helper to format weight display with indicator for default values
  const formatWeight = (value: number): string => {
    // Always use 2 decimal places for consistency
    const formatted = value.toFixed(2);
    
    // If it's very close to 0.5, explicitly show it as 0.50 (default)
    if (isDefaultWeight(value)) {
      return `0.50 (default)`;
    }
    
    return formatted;
  };
  
  // Add animation for the toggle button
  const pulseAnim = useRef(new Animated.Value(1)).current;
  
  // Set up pulse animation for iOS
  useEffect(() => {
    // Animation has been disabled
    return () => {
      // Stop animation when component unmounts
      pulseAnim.stopAnimation();
    };
  }, [pulseAnim, visible]);
  
  // Get auth context
  const { user } = useAuth();
  const dispatch = useAppDispatch();
  
  // Get state from Redux store
  const questions = useAppSelector(state => state.trivia.questions);
  const userProfile = useAppSelector(state => state.trivia.userProfile);
  const personalizedFeed = useAppSelector(state => state.trivia.personalizedFeed);
  const feedExplanations = useAppSelector(state => state.trivia.feedExplanations);
  const syncedWeightChanges = useAppSelector(state => state.trivia.syncedWeightChanges);
  const lastSyncTime = useAppSelector(state => state.trivia.lastSyncTime);
  
  // Store previous profile and feed to track changes
  const prevProfileRef = useRef(userProfile);
  const prevFeedRef = useRef<string[]>([]);
  
  // Function to load weights from database
  const loadWeightsFromDB = async () => {
    // DISABLED: No longer fetch weights directly from DB
    // This is now handled exclusively by SimplifiedSyncManager
    console.log('InteractionTracker: loadWeightsFromDB has been DISABLED');
    console.log('InteractionTracker: All database access is now handled by SimplifiedSyncManager');
    
    if (user?.id) {
      try {
        setIsLoadingWeights(true);
        
        // Just log current profile state but don't fetch
        console.log('InteractionTracker: Using current Redux state:', {
          topicCount: Object.keys(userProfile.topics || {}).length,
          coldStartComplete: userProfile.coldStartComplete,
          lastRefreshed: userProfile.lastRefreshed
            ? new Date(userProfile.lastRefreshed).toISOString()
            : 'none'
        });
        
        // Set the updated timestamp without actually fetching
        setLastWeightUpdateTime(Date.now());
        
        setIsLoadingWeights(false);
      } catch (error) {
        console.error('InteractionTracker: Error in weights observer:', error);
        setIsLoadingWeights(false);
      }
    }
  };
  
  // Toggle explanation visibility
  const toggleExplanation = (itemId: string) => {
    setExpandedExplanations(prev => ({
      ...prev,
      [itemId]: !prev[itemId]
    }));
  };
  
  // Manually process feed changes - disable automatic tracking to prevent infinite loops
  const processFeedChanges = () => {
    if (personalizedFeed.length > 0) {
      const now = Date.now();
      const currentFeedIds = personalizedFeed.map(item => item.id);
      
      // Find added items
      const addedItems = personalizedFeed.filter(item => !prevFeedRef.current.includes(item.id));
      
      // Process new items
      if (addedItems.length > 0) {
        const newChanges: FeedChange[] = addedItems.map(item => {
          // Get explanations for this item
          const itemExplanations = feedExplanations[item.id] || [];
          
          // Extract weight-based selection info
          const weightFactors: FeedChange['weightFactors'] = {
            topic: item.topic,
          };
          
          // Check if there's a topic weight in user profile for this category
          if (userProfile.topics && userProfile.topics[item.topic]) {
            weightFactors.topicWeight = userProfile.topics[item.topic].weight;
            
            // Check if there's a subtopic weight
            const subtopic = item.tags?.[0] || 'General';
            if (userProfile.topics[item.topic].subtopics?.[subtopic]) {
              weightFactors.subtopicWeight = userProfile.topics[item.topic].subtopics[subtopic].weight;
            }
          }
          
          // Determine selection method based on explanations
          if (itemExplanations.some(exp => exp.includes("Cold Start"))) {
            weightFactors.selectionMethod = "Cold Start Algorithm";
            
            // Further analyze the cold start phase
            const phaseMatch = itemExplanations.find(exp => exp.includes("Phase"))?.match(/Phase (\d+)/);
            if (phaseMatch) {
              const phase = parseInt(phaseMatch[1]);
              weightFactors.preferenceReason = phase === 1 ? "Initial exploration phase" :
                phase === 2 ? "Building on initial preferences" :
                phase === 3 ? "Refining based on correct answers" :
                "Transitioning to personalized feed";
            }
          } else if (itemExplanations.some(exp => exp.includes("Exploration"))) {
            weightFactors.selectionMethod = "Exploration Selection";
            weightFactors.preferenceReason = itemExplanations.find(exp => 
              exp.includes("Exploration"))?.replace("Exploration: ", "");
          } else if (itemExplanations.some(exp => exp.includes("maintain feed continuity"))) {
            weightFactors.selectionMethod = "Feed Continuity";
            weightFactors.preferenceReason = "Added after answering to maintain feed";
          } else if (itemExplanations.some(exp => exp.includes("extend feed"))) {
            weightFactors.selectionMethod = "Feed Extension";
            weightFactors.preferenceReason = "Added proactively while approaching feed end";
          }
          
          return {
            timestamp: now,
            type: 'added',
            itemId: item.id,
            questionText: item.question || `Question ${item.id.substring(0, 5)}...`,
            explanations: itemExplanations,
            weightFactors
          };
        });
        
        setFeedChanges(prev => [...prev, ...newChanges]);
      }
      
      // Update previous feed reference
      prevFeedRef.current = currentFeedIds;
    }
  };
  
  // Initialize refs on mount only
  useEffect(() => {
    prevFeedRef.current = personalizedFeed.map(item => item.id);
    // Initial process once on mount only
    processFeedChanges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array - only run once
  
  // Fetch weight changes from database on component mount
  useEffect(() => {
    loadWeightsFromDB();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]); // Only run when user changes
  
  // Track last sync time changes
  useEffect(() => {
    if (lastSyncTime > 0) {
      setLastWeightUpdateTime(lastSyncTime);
    }
  }, [lastSyncTime]);
  
  // Watch for changes in the userProfile
  useEffect(() => {
    // Skip the initial render
    if (prevProfileRef.current === userProfile) return;
    
    // Find what changed in the profile
    const now = Date.now();
    const changes: ProfileChange[] = [];
    
    // Check topics
    if (userProfile.topics && prevProfileRef.current.topics) {
      Object.entries(userProfile.topics).forEach(([topic, topicData]) => {
        const prevTopicData = prevProfileRef.current.topics[topic];
        if (!prevTopicData || topicData.weight !== prevTopicData.weight) {
          changes.push({
            timestamp: now,
            attribute: `Topic: ${topic}`,
            oldValue: prevTopicData?.weight || 0,
            newValue: topicData.weight,
            questionId: 'unknown' // We don't know which question caused this change
          });
        }
        
        // Check subtopics
        if (topicData.subtopics) {
          Object.entries(topicData.subtopics).forEach(([subtopic, subtopicData]) => {
            const prevSubtopicData = prevTopicData?.subtopics?.[subtopic];
            if (!prevSubtopicData || subtopicData.weight !== prevSubtopicData.weight) {
              changes.push({
                timestamp: now,
                attribute: `Subtopic: ${topic}/${subtopic}`,
                oldValue: prevSubtopicData?.weight || 0,
                newValue: subtopicData.weight,
                questionId: 'unknown'
              });
            }
          });
        }
      });
    }
    
    // Check cold start status changes
    if (userProfile.coldStartComplete !== prevProfileRef.current.coldStartComplete) {
      changes.push({
        timestamp: now,
        attribute: 'Cold Start Status',
        oldValue: prevProfileRef.current.coldStartComplete ? 'Complete' : 'In Progress',
        newValue: userProfile.coldStartComplete ? 'Complete' : 'In Progress',
        questionId: 'unknown'
      });
    }
    
    // Get questionId that caused the change
    if (changes.length > 0 && interactions.length > 0) {
      const latestInteraction = interactions[interactions.length - 1];
      changes.forEach(change => {
        change.questionId = latestInteraction.questionId;
      });
    }
    
    // Add to profile changes list
    if (changes.length > 0) {
      setProfileChanges(prev => [...prev, ...changes]);
    }
    
    // Update previous profile
    prevProfileRef.current = userProfile;
  }, [userProfile]); // Remove interactions dependency
  
  // Listen for database operations
  useEffect(() => {
    // Add listener for database operations
    const handleDbOperation = (operation: DbOperation) => {
      // Skip deprecated tables completely
      if (
        operation.table === 'user_feed_changes' || 
        operation.table === 'user_interactions' || 
        operation.table === 'user_weight_changes'
      ) {
        return; // Don't track operations on deprecated tables
      }
      
      // For allowed tables: keep detailed history
        setDbOperations(prev => [operation, ...prev].slice(0, 100));
    };
    
    dbEventEmitter.on('db-operation', handleDbOperation);
    
    // Clean up the listener when component unmounts
    return () => {
      dbEventEmitter.removeListener('db-operation', handleDbOperation);
    };
  }, []);
  
  // Watch for changes in the questions state
  useEffect(() => {
    // Find the most recent question that's changed
    const questionIds = Object.keys(questions);
    if (questionIds.length === 0) return;
    
    // Process all answered or skipped questions that we haven't logged yet
    const now = Date.now();
    const newInteractions: InteractionLog[] = [];
    
    questionIds.forEach(id => {
      const question = questions[id];
      if (!question) return;
      
      // Get existing interaction for this question if any
      const existingInteraction = interactions.find(log => log.questionId === id);
      
      // Only process if: 
      // 1. No existing interaction for this question, or
      // 2. Status has changed (e.g., from skipped to answered)
      const shouldProcess = 
        !existingInteraction || 
        (existingInteraction && question.status === 'answered' && existingInteraction.type === 'skipped');
      
      if (question.status !== 'unanswered' && shouldProcess) {
        const timeSpent = question.timeSpent || 0;
        
        // Determine if correct or incorrect for answered questions
        let type: 'correct' | 'incorrect' | 'skipped' = 'skipped';
        if (question.status === 'answered' && question.answerIndex !== undefined) {
          // Find the feed item to determine if the answer was correct
          const feedItem = feedData.find(item => item.id === id);
          const isCorrect = feedItem?.answers?.[question.answerIndex]?.isCorrect || false;
          type = isCorrect ? 'correct' : 'incorrect';
        }
        
        // Find the question text if possible
        const questionText = getQuestionText(id);
        
        // Create a new interaction log
        const newInteraction: InteractionLog = {
          timestamp: now,
          type,
          questionId: id,
          timeSpent,
          questionText
        };
        
        // If updating an existing interaction
        if (existingInteraction) {
          console.log(`Updating interaction for ${id} from ${existingInteraction.type} to ${type}`);
          
          // Update the interactions array by replacing the old interaction
          setInteractions(prev => 
            prev.map(log => 
              log.questionId === id ? newInteraction : log
            )
          );
          
          // Update summary to reflect the change
          setSummary(prev => {
            const updatedSummary = { ...prev };
            // Decrement the old type count
            updatedSummary[existingInteraction.type]--;
            // Increment the new type count
            updatedSummary[type]++;
            return updatedSummary;
          });
        } else {
          // New interaction - add to array for batch update
          newInteractions.push(newInteraction);
        }
      }
    });
    
    // Update state once with all new interactions
    if (newInteractions.length > 0) {
      console.log(`Adding ${newInteractions.length} new interactions to tracker`);
      setInteractions(prev => [...prev, ...newInteractions]);
      
      // Update summary based on new interactions
      setSummary(prev => {
        const newSummary = { ...prev };
        newInteractions.forEach(interaction => {
          newSummary[interaction.type]++;
          newSummary.totalTime += interaction.timeSpent;
        });
        newSummary.avgTime = newSummary.totalTime / 
          (newSummary.correct + newSummary.incorrect + newSummary.skipped || 1);
        return newSummary;
      });
    }
  }, [questions, feedData, interactions]);
  
  // Track weight changes
  useEffect(() => {
    // Check if there are new weight changes
    if (syncedWeightChanges.length > 0) {
      const existingIds = new Set(weightChanges.map(wc => `${wc.timestamp}-${wc.questionId}`));
      
      // Filter only new weight changes
      const newWeightChanges = syncedWeightChanges.filter(
        wc => !existingIds.has(`${wc.timestamp}-${wc.questionId}`)
      );
      
      if (newWeightChanges.length > 0) {
        setWeightChanges(prev => [...prev, ...newWeightChanges]);
      }
    }
  }, [syncedWeightChanges]);
  
  // Helper to get question text
  const getQuestionText = (questionId: string): string => {
    // If we have the feed item for this question, get its text
    const feedItem = feedData.find(item => item.id === questionId);
    if (feedItem) {
      const text = feedItem.question || 'Unknown question';
      return text.substring(0, 30) + (text.length > 30 ? '...' : '');
    }
    return `Question ${questionId.substring(0, 5)}...`;
  };
  
  // Get personalization information
  const getPersonalizationInfo = () => {
    // Top 3 interests (using topics as interests)
    const topInterests = Object.entries(userProfile.topics || {})
      .sort(([, a], [, b]) => b.weight - a.weight)
      .slice(0, 3)
      .map(([topic, data]) => ({ topic, score: data.weight }));
    
    // Cold start information
    const totalQuestionsAnswered = userProfile.totalQuestionsAnswered || 0;
    const inColdStart = !userProfile.coldStartComplete && totalQuestionsAnswered < 20;
    
    let coldStartPhase = 0;
    if (inColdStart) {
      if (totalQuestionsAnswered >= 12) {
        coldStartPhase = 3;
      } else if (totalQuestionsAnswered >= 3) {
        coldStartPhase = 2;
      } else {
        coldStartPhase = 1;
      }
    }
    
    return {
      topInterests,
      totalQuestionsAnswered,
      inColdStart,
      coldStartPhase,
      personalizedFeedSize: personalizedFeed.length
    };
  };
  
  // Helper function to get weight trend based on recent weight changes
  const getWeightTrend = (
    name: string, 
    type: 'topic' | 'subtopic' | 'branch', 
    parentTopic?: string, 
    parentSubtopic?: string
  ): number => {
    // Filter to relevant weight changes
    const relevantChanges = weightChanges.filter(change => {
      if (type === 'topic') {
        return change.topic === name;
      } else if (type === 'subtopic') {
        return change.topic === parentTopic && change.subtopic === name;
      } else {
        return change.topic === parentTopic &&
          change.subtopic === parentSubtopic;
      }
    });
    
    if (relevantChanges.length === 0) return 0;
    
    // Calculate the trend as the sum of recent changes
    let trend = 0;
    relevantChanges.forEach(change => {
      if (type === 'topic') {
        trend += change.newWeights.topicWeight - change.oldWeights.topicWeight;
      } else if (type === 'subtopic' && change.newWeights.subtopicWeight !== undefined && 
        change.oldWeights.subtopicWeight !== undefined) {
        trend += change.newWeights.subtopicWeight - change.oldWeights.subtopicWeight;
      } else if (type === 'branch' && change.newWeights.branchWeight !== undefined && 
        change.oldWeights.branchWeight !== undefined) {
        trend += change.newWeights.branchWeight - change.oldWeights.branchWeight;
      }
    });
    
    // Round to 2 decimal places to avoid tiny floating point differences
    return Math.round(trend * 100) / 100;
  };
  
  const renderInteractionsTab = () => (
    <ScrollView style={styles.tabScrollView}>
      <View style={styles.summaryContainer}>
        <View style={styles.statItem}>
          <ThemedText style={styles.statValue}>{summary.correct}</ThemedText>
          <ThemedText style={[styles.statLabel, { color: '#4CAF50' }]}>Correct</ThemedText>
        </View>
        <View style={styles.statItem}>
          <ThemedText style={styles.statValue}>{summary.incorrect}</ThemedText>
          <ThemedText style={[styles.statLabel, { color: '#F44336' }]}>Incorrect</ThemedText>
        </View>
        <View style={styles.statItem}>
          <ThemedText style={styles.statValue}>{summary.skipped}</ThemedText>
          <ThemedText style={[styles.statLabel, { color: '#FF9800' }]}>Skipped</ThemedText>
        </View>
        <View style={styles.statItem}>
          <ThemedText style={styles.statValue}>
            {Math.round(summary.avgTime / 1000)}s
          </ThemedText>
          <ThemedText style={styles.statLabel}>Avg Time</ThemedText>
        </View>
      </View>
      
      <ThemedText type="subtitle">Recent Interactions</ThemedText>
      
      <View style={styles.interactionsContainer}>
        {interactions.length === 0 ? (
          <ThemedText style={styles.emptyText}>
            No interactions logged yet. Answer some questions!
          </ThemedText>
        ) : (
          interactions.slice().reverse().map((log, index) => (
            <View 
              key={index} 
              style={[
                styles.logItem, 
                log.type === 'correct' ? styles.correctLog : 
                log.type === 'incorrect' ? styles.incorrectLog : styles.skippedLog
              ]}
            >
              <View style={styles.logHeader}>
                <ThemedText style={styles.logType}>
                  {log.type.toUpperCase()}
                </ThemedText>
                <ThemedText style={styles.logTime}>
                  {new Date(log.timestamp).toLocaleTimeString()}
                </ThemedText>
              </View>
              <ThemedText style={styles.logQuestion}>{log.questionText}</ThemedText>
              <ThemedText style={styles.logTimeSpent}>
                Time: {(log.timeSpent / 1000).toFixed(1)}s
              </ThemedText>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
  
  const renderFeedStatusTab = () => {
    const info = getPersonalizationInfo();
    
    return (
      <ScrollView style={styles.tabScrollView}>
        <View style={styles.feedStatusContainer}>
          {/* Cold Start Status */}
          <View style={styles.statusSection}>
            <ThemedText style={styles.statusLabel}>Profile Status:</ThemedText>
            <ThemedText style={styles.statusValue}>
              {info.inColdStart ? `Cold Start Phase ${info.coldStartPhase}` : 'Personalized'}
            </ThemedText>
            <View style={styles.progressBar}>
              <View 
                style={[
                  styles.progressFill, 
                  { width: `${Math.min(info.totalQuestionsAnswered * 5, 100)}%` },
                  info.inColdStart ? styles.coldStartProgress : styles.personalizedProgress
                ]} 
              />
            </View>
            <ThemedText style={styles.statusSubtext}>
              {info.totalQuestionsAnswered}/20 Questions Answered
            </ThemedText>
          </View>
          
          {/* Top Interests */}
          <View style={styles.statusSection}>
            <ThemedText style={styles.statusLabel}>Top Topics:</ThemedText>
            {info.topInterests.length > 0 ? (
              info.topInterests.map((interest, index) => (
                <View key={index} style={styles.interestItem}>
                  <ThemedText style={styles.interestName}>{interest.topic}</ThemedText>
                  <View style={styles.interestBar}>
                    <View style={[styles.interestFill, { width: `${Math.min(interest.score * 100, 100)}%` }]} />
                  </View>
                  <ThemedText style={styles.interestScore}>{interest.score.toFixed(1)}</ThemedText>
                </View>
              ))
            ) : (
              <ThemedText style={styles.emptyText}>No topics detected yet</ThemedText>
            )}
          </View>
          
          {/* Interactions Count */}
          <View style={styles.statusSection}>
            <ThemedText style={styles.statusLabel}>Stats:</ThemedText>
            <View style={styles.preferenceItem}>
              <ThemedText style={styles.preferenceName}>Interactions:</ThemedText>
              <ThemedText style={styles.preferenceValue}>
                {Object.keys(userProfile.interactions || {}).length}
              </ThemedText>
            </View>
          </View>
        </View>
        
        <ThemedText type="subtitle">Profile Updates</ThemedText>
        
        <View style={styles.profileChangesContainer}>
          {profileChanges.length === 0 ? (
            <ThemedText style={styles.emptyText}>
              No profile changes detected yet
            </ThemedText>
          ) : (
            profileChanges.slice().reverse().map((change, index) => (
              <View key={index} style={styles.profileChangeItem}>
                <View style={styles.logHeader}>
                  <ThemedText style={styles.logType}>{change.attribute}</ThemedText>
                  <ThemedText style={styles.logTime}>
                    {new Date(change.timestamp).toLocaleTimeString()}
                  </ThemedText>
                </View>
                <ThemedText style={styles.changeText}>
                  {typeof change.oldValue === 'number' && typeof change.newValue === 'number' 
                    ? `${change.oldValue.toFixed(1)} → ${change.newValue.toFixed(1)} (${change.newValue > change.oldValue ? '+' : ''}${(change.newValue - change.oldValue).toFixed(1)})`
                    : `${change.oldValue} → ${change.newValue}`
                  }
                </ThemedText>
                <ThemedText style={styles.logTimeSpent}>Question: {getQuestionText(change.questionId)}</ThemedText>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    );
  };
  
  const renderFeedListTab = () => {
    return (
      <ScrollView style={styles.tabScrollView}>
        <View style={styles.feedListContainer}>
          <View style={styles.statusSection}>
            <ThemedText style={styles.statusLabel}>Current Feed:</ThemedText>
            <View style={styles.feedHeaderRow}>
              <ThemedText style={styles.statusValue}>
                {personalizedFeed.length} Questions
              </ThemedText>
              <TouchableOpacity 
                style={[styles.refreshButton, {backgroundColor: 'rgba(10, 126, 164, 0.3)'}]}
                onPress={() => processFeedChanges()}
              >
                <Feather name="refresh-cw" size={16} color="#0A7EA4" />
                <ThemedText style={[styles.refreshText, {color: '#0A7EA4'}]}>Refresh</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
          
          {/* Recent Feed Changes */}
          <ThemedText type="subtitle">Recent Feed Changes</ThemedText>
          
          <View style={styles.feedChangesContainer}>
            {feedChanges.length === 0 ? (
              <ThemedText style={styles.emptyText}>
                No feed changes detected yet. Press refresh to check for changes.
              </ThemedText>
            ) : (
              feedChanges.slice().reverse().slice(0, 5).map((change, index) => (
                <View key={index} style={styles.feedChangeItem}>
                  <View style={styles.logHeader}>
                    <ThemedText style={styles.logType}>
                      {change.type === 'added' ? 'ADDED TO FEED' : 'REMOVED FROM FEED'}
                    </ThemedText>
                    <ThemedText style={styles.logTime}>
                      {new Date(change.timestamp).toLocaleTimeString()}
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.logQuestion}>{change.questionText}</ThemedText>
                  
                  {change.explanations.length > 0 && (
                    <View style={styles.explanationContainer}>
                      <ThemedText style={styles.explanationHeader}>Why:</ThemedText>
                      {change.explanations.map((explanation, i) => (
                        <ThemedText key={i} style={styles.explanationText}>• {explanation}</ThemedText>
                      ))}
                    </View>
                  )}
                  
                  {/* Add weight-based selection explanation */}
                  {change.weightFactors && (
                    <View style={styles.weightFactorsContainer}>
                      <ThemedText style={styles.explanationHeader}>Selection Factors:</ThemedText>
                      <ThemedText style={styles.weightFactorText}>
                        • Category: <ThemedText style={styles.weightValue}>{change.weightFactors.topic}</ThemedText>
                      </ThemedText>
                      
                      {change.weightFactors.topicWeight !== undefined && (
                        <ThemedText style={styles.weightFactorText}>
                          • Topic Weight: <ThemedText style={styles.weightValue}>
                            {change.weightFactors.topicWeight.toFixed(2)}
                          </ThemedText>
                        </ThemedText>
                      )}
                      
                      {change.weightFactors.subtopicWeight !== undefined && (
                        <ThemedText style={styles.weightFactorText}>
                          • Subtopic Weight: <ThemedText style={styles.weightValue}>
                            {change.weightFactors.subtopicWeight.toFixed(2)}
                          </ThemedText>
                        </ThemedText>
                      )}
                      
                      {change.weightFactors.selectionMethod && (
                        <ThemedText style={styles.weightFactorText}>
                          • Method: <ThemedText style={styles.weightValue}>
                            {change.weightFactors.selectionMethod}
                          </ThemedText>
                        </ThemedText>
                      )}
                      
                      {change.weightFactors.preferenceReason && (
                        <ThemedText style={styles.weightFactorText}>
                          • Reason: <ThemedText style={styles.weightValue}>
                            {change.weightFactors.preferenceReason}
                          </ThemedText>
                        </ThemedText>
                      )}
                    </View>
                  )}
                </View>
              ))
            )}
          </View>
          
          {/* All Feed Items */}
          <ThemedText type="subtitle" style={styles.sectionHeader}>All Feed Items</ThemedText>
          
          <View style={styles.allFeedItemsContainer}>
            {personalizedFeed.length === 0 ? (
              <ThemedText style={styles.emptyText}>No feed items available</ThemedText>
            ) : (
              personalizedFeed.map((item, index) => (
                <View key={index} style={styles.feedItem}>
                  <View style={styles.feedItemHeader}>
                    <ThemedText style={styles.feedItemNumber}>#{index + 1}</ThemedText>
                    <ThemedText style={styles.feedItemTopic}>{item.topic || 'Unknown'}</ThemedText>
                  </View>
                  <ThemedText style={styles.feedItemText}>{item.question || `Question ${item.id.substring(0, 5)}...`}</ThemedText>
                  {item.tags && item.tags.length > 0 && (
                    <View style={styles.tagsContainer}>
                      {item.tags.map((tag, i) => (
                        <View key={i} style={styles.tag}>
                          <ThemedText style={styles.tagText}>{tag}</ThemedText>
                        </View>
                      ))}
                    </View>
                  )}
                  
                  {feedExplanations[item.id] && (
                    <>
                      <TouchableOpacity 
                        style={styles.explanationButton}
                        onPress={() => toggleExplanation(item.id)}
                      >
                        <ThemedText style={styles.explanationButtonText}>
                          {expandedExplanations[item.id] ? 'Hide Explanation' : 'Show Explanation +'}
                        </ThemedText>
                      </TouchableOpacity>
                      
                      {expandedExplanations[item.id] && (
                        <View style={styles.explanationContainer}>
                          <ThemedText style={styles.explanationHeader}>Why this question:</ThemedText>
                          {feedExplanations[item.id].map((explanation, i) => (
                            <ThemedText key={i} style={styles.explanationText}>• {explanation}</ThemedText>
                          ))}
                          
                          {/* Add weight-based info for each feed item */}
                          {userProfile.topics && userProfile.topics[item.topic] && (
                            <>
                              <ThemedText style={[styles.explanationHeader, {marginTop: 8}]}>
                                Weight Factors:
                              </ThemedText>
                              <ThemedText style={styles.explanationText}>
                                • Topic: <ThemedText style={styles.weightValue}>{userProfile.topics[item.topic].weight.toFixed(2)}</ThemedText>
                              </ThemedText>
                              
                              {item.tags && item.tags[0] && 
                               userProfile.topics[item.topic].subtopics && 
                               userProfile.topics[item.topic].subtopics[item.tags[0]] && (
                                <ThemedText style={styles.explanationText}>
                                  • Subtopic weight: {
                                    userProfile.topics[item.topic].subtopics[item.tags[0]].weight.toFixed(2)
                                  }
                                </ThemedText>
                              )}
                              
                              {/* Add the question type (preference vs exploration) */}
                              <ThemedText style={styles.explanationText}>
                                • Question type: {
                                  feedExplanations[item.id]?.some(exp => exp.includes('Exploration question')) 
                                    ? 'Exploration' 
                                    : 'Preferred'
                                }
                              </ThemedText>
                                
                              {/* Add the selection mechanism */}
                              {feedExplanations[item.id]?.find(exp => exp.includes('Selection mechanism:')) && (
                                <ThemedText style={styles.explanationText}>
                                  • {feedExplanations[item.id].find(exp => exp.includes('Selection mechanism:'))?.replace('Selection mechanism: ', '')}
                                </ThemedText>
                              )}
                            </>
                          )}
                        </View>
                      )}
                    </>
                  )}
                </View>
              ))
            )}
          </View>
        </View>
      </ScrollView>
    );
  };
  
  // Calculate database operation stats
  const getDbStats = () => {
    const totalOperations = dbOperations.length;
    const sentOperations = dbOperations.filter(op => op.direction === 'sent').length;
    const receivedOperations = dbOperations.filter(op => op.direction === 'received').length;
    const successOperations = dbOperations.filter(op => op.status === 'success').length;
    const errorOperations = dbOperations.filter(op => op.status === 'error').length;
    
    // Count operations by table
    const tableStats: {[table: string]: number} = {};
    dbOperations.forEach(op => {
      tableStats[op.table] = (tableStats[op.table] || 0) + 1;
    });
    
    // Count operations by operation type
    const operationStats: {[operation: string]: number} = {};
    dbOperations.forEach(op => {
      operationStats[op.operation] = (operationStats[op.operation] || 0) + 1;
    });
    
    return {
      totalOperations,
      sentOperations,
      receivedOperations,
      successOperations,
      errorOperations,
      tableStats,
      operationStats
    };
  };

  // Function to prepare DB operations text - moved to component level
  const prepareDbOperationsText = () => {
    // Get the operations to display
    const filteredOperations = tableFilter 
      ? dbOperations.filter(op => op.table.includes(tableFilter)) 
      : dbOperations;
    
    const recordsToDisplay = showAllRecords 
      ? filteredOperations 
      : filteredOperations.slice(0, visibleDbRecords);
      
    try {
      // Format operations as text
      let text = "DATABASE OPERATIONS LOG\n\n";
      
      if (recordsToDisplay.length === 0) {
        text += "No database operations to display.";
      } else {
        recordsToDisplay.forEach((op, index) => {
          const timestamp = formatTimestamp(op.timestamp);
          const actionType = getActionType(op);
          text += `--- OPERATION ${index + 1} ---\n`;
          text += `Time: ${timestamp}\n`;
          text += `Direction: ${op.direction}\n`;
          text += `Table: ${op.table}\n`;
          text += `Action: ${actionType}\n`;
          text += `Operation: ${op.operation}\n`;
          text += `Records: ${op.records}\n`;
          text += `Status: ${op.status}\n`;
          text += `Data: ${JSON.stringify(op.data, null, 2)}\n\n`;
        });
      }
      
      // Set the text to be displayed in the TextInput
      setCopyText(text);
      // Show the copy UI
      setShowCopyUI(true);
      
      // Provide feedback
      Alert.alert(
        "Copy Instructions", 
        "1. Tap inside the text box\n2. Select all text (long-press → Select All)\n3. Copy to clipboard (long-press → Copy)",
        [{ text: "OK" }]
      );
    } catch (error) {
      console.error("Failed to generate DB operations log:", error);
      Alert.alert("Error", "Failed to generate DB operations log");
    }
  };

  // Render the database operations log tab
  const renderDbLogTab = () => {
    const stats = getDbStats();
    
    // Filter operations by table name if filter is set
    const filteredOperations = tableFilter 
      ? dbOperations.filter(op => op.table.includes(tableFilter)) 
      : dbOperations;
    
    // Calculate how many records to display
    const recordsToDisplay = showAllRecords 
      ? filteredOperations 
      : filteredOperations.slice(0, visibleDbRecords);
    
    // Detect active syncing
    const activeSyncing = dbOperations.length > 0 && 
      Date.now() - dbOperations[0].timestamp < 5000 && 
      dbOperations[0].direction === 'sent';
    
    return (
      <ScrollView style={styles.scrollView}>
        {/* Copy UI that appears when user wants to copy */}
        {showCopyUI && (
          <View style={{
            padding: 12,
            backgroundColor: '#f5f5f5',
            borderRadius: 8,
            marginBottom: 12,
            borderWidth: 1,
            borderColor: '#ddd',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 4,
            elevation: 2,
          }}>
            <View style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}>
              <ThemedText style={{fontWeight: 'bold', fontSize: 16, color: '#333333'}}>
                DB Log Contents
              </ThemedText>
              <TouchableOpacity 
                onPress={() => setShowCopyUI(false)}
                style={{
                  backgroundColor: '#ff5252',
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 4,
                }}
              >
                <ThemedText style={{color: 'white', fontSize: 12, fontWeight: 'bold'}}>Close</ThemedText>
              </TouchableOpacity>
            </View>
            
            <View style={{
              backgroundColor: '#333',
              padding: 8,
              borderRadius: 6,
              marginBottom: 10,
            }}>
              <ThemedText style={{color: '#fff', fontSize: 13, fontWeight: '500'}}>
                Instructions:
              </ThemedText>
              <ThemedText style={{color: '#fff', fontSize: 12, marginTop: 4}}>
                1. Tap and hold inside the text area below
              </ThemedText>
              <ThemedText style={{color: '#fff', fontSize: 12, marginTop: 2}}>
                2. Select "Select All" from the menu
              </ThemedText>
              <ThemedText style={{color: '#fff', fontSize: 12, marginTop: 2}}>
                3. Select "Copy" from the menu
              </ThemedText>
            </View>
            
            <View style={{
              borderWidth: 2,
              borderColor: '#0A7EA4',
              borderRadius: 6,
              overflow: 'hidden',
            }}>
              <ScrollView style={{height: 220}} nestedScrollEnabled={true}>
                <TextInput
                  style={{
                    minHeight: 220,
                    padding: 10,
                    backgroundColor: '#fff',
                    color: '#333',
                    fontSize: 12,
                    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                    textAlignVertical: 'top',
                  }}
                  value={copyText}
                  multiline={true}
                  scrollEnabled={true}
                  editable={true}
                  selectTextOnFocus={true}
                />
              </ScrollView>
            </View>
            
            <TouchableOpacity 
              style={{
                backgroundColor: '#4CAF50',
                padding: 10,
                borderRadius: 6,
                alignItems: 'center',
                marginTop: 10,
              }}
              onPress={() => {
                // Attempt to select all text programmatically (may not work on all platforms)
                // This is a fallback in case the user can't select manually
                Alert.alert(
                  "Manual Copy Required",
                  "Please use your device's built-in text selection and copy functions",
                  [{ text: "OK" }]
                );
              }}
            >
              <ThemedText style={{color: 'white', fontWeight: 'bold'}}>
                Select All Text
              </ThemedText>
            </TouchableOpacity>
          </View>
        )}
        
        {/* Enhanced Summary statistics */}
        <ThemedView style={styles.statsCard}>
          <View style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 10,
          }}>
            <ThemedText style={styles.statsCardTitle}>Database Operations</ThemedText>
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
            }}>
              <ThemedText style={{
                fontSize: 12,
                color: '#666666',
                marginRight: 8,
              }}>
                Last op: {dbOperations.length > 0 ? formatTimestamp(dbOperations[0].timestamp) : 'Never'}
              </ThemedText>
              {activeSyncing && (
                <View style={{
                  backgroundColor: '#FF9800',
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 4,
                }}>
                  <ThemedText style={{color: '#FFFFFF', fontSize: 10, fontWeight: 'bold'}}>SYNCING</ThemedText>
                </View>
              )}
            </View>
          </View>
          
          <View style={styles.statsRow}>
            <View style={[styles.statItem, {backgroundColor: 'rgba(10, 126, 164, 0.1)', borderRadius: 8, padding: 8}]}>
              <ThemedText style={[styles.statValue, {fontSize: 20}]}>{stats.totalOperations}</ThemedText>
              <ThemedText style={styles.statLabel}>Total</ThemedText>
            </View>
            <View style={[styles.statItem, {backgroundColor: 'rgba(76, 175, 80, 0.1)', borderRadius: 8, padding: 8}]}>
              <ThemedText style={[styles.statValue, styles.sentText, {fontSize: 18}]}>{stats.sentOperations}</ThemedText>
              <ThemedText style={styles.statLabel}>Sent</ThemedText>
            </View>
            <View style={[styles.statItem, {backgroundColor: 'rgba(33, 150, 243, 0.1)', borderRadius: 8, padding: 8}]}>
              <ThemedText style={[styles.statValue, styles.receivedText, {fontSize: 18}]}>{stats.receivedOperations}</ThemedText>
              <ThemedText style={styles.statLabel}>Received</ThemedText>
            </View>
            <View style={[styles.statItem, {backgroundColor: 'rgba(0, 200, 83, 0.1)', borderRadius: 8, padding: 8}]}>
              <ThemedText style={[styles.statValue, styles.successText, {fontSize: 18}]}>{stats.successOperations}</ThemedText>
              <ThemedText style={styles.statLabel}>Success</ThemedText>
            </View>
            <View style={[styles.statItem, {backgroundColor: 'rgba(244, 67, 54, 0.1)', borderRadius: 8, padding: 8}]}>
              <ThemedText style={[styles.statValue, styles.errorText, {fontSize: 18}]}>{stats.errorOperations}</ThemedText>
              <ThemedText style={styles.statLabel}>Errors</ThemedText>
            </View>
          </View>
        </ThemedView>
        
        {/* Operation Type & Table Distribution */}
        <View style={{
          flexDirection: 'row',
          marginBottom: 10,
        }}>
          {/* By Table statistics */}
          <ThemedView style={{
            flex: 1,
            marginRight: 4,
            padding: 12,
            backgroundColor: '#FFFFFF',
            borderRadius: 8,
            borderWidth: 1,
            borderColor: '#e0e0e0',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.1,
            shadowRadius: 2,
            elevation: 1,
          }}>
            <ThemedText style={{
              fontSize: 14,
              fontWeight: '600',
              color: '#333333',
              marginBottom: 8,
            }}>By Table</ThemedText>
            <View style={{
              marginTop: 5,
            }}>
              {Object.entries(stats.tableStats).map(([table, count]) => {
                const percentage = Math.round((count / stats.totalOperations) * 100);
                return (
                <TouchableOpacity 
                  key={table} 
                  style={[
                      {
                        flexDirection: 'column',
                        marginBottom: 8,
                      },
                      tableFilter === table && {
                        backgroundColor: 'rgba(33, 150, 243, 0.1)',
                        borderRadius: 4,
                        padding: 4,
                      },
                  ]}
                  onPress={() => setTableFilter(tableFilter === table ? '' : table)}
                >
                    <View style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                    }}>
                      <View style={[{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        marginRight: 5,
                        backgroundColor: tableColors[table] || '#999'
                      }]} />
                  <ThemedText style={[
                        {
                          fontSize: 12,
                          color: '#333333',
                        },
                        tableFilter === table && {
                          color: '#0A7EA4',
                          fontWeight: 'bold',
                        },
                      ]} numberOfLines={1} ellipsizeMode="middle">
                        {table}
                  </ThemedText>
                    </View>
                    <View style={styles.tableStatDataContainer}>
                      <View style={styles.tableStatBarContainer}>
                        <View style={[styles.tableStatBar, {
                          width: `${percentage}%`,
                          backgroundColor: tableColors[table] || '#999'
                        }]} />
                      </View>
                  <ThemedText style={[
                        styles.tableStatValue,
                    tableFilter === table && styles.selectedTableFilterText
                  ]}>
                        {count} ({percentage}%)
                  </ThemedText>
                    </View>
                </TouchableOpacity>
                );
              })}
            </View>
          </ThemedView>

          {/* By Operation statistics */}
          <ThemedView style={[styles.statsDistributionCard, {flex: 1, marginLeft: 4}]}>
            <View style={{width: '100%'}}>
              {Object.entries(stats.operationStats).map(([operation, count]) => {
                const percentage = Math.round((count / stats.totalOperations) * 100);
                return (
                  <View key={operation} style={styles.operationStatItem}>
                    <View style={styles.operationStatLabelContainer}>
                      <View style={[styles.operationStatDot, {
                        backgroundColor: getOperationColor(operation)
                      }]} />
                      <ThemedText style={styles.operationStatLabel}>
                        {operation}
                      </ThemedText>
                </View>
                    <View style={styles.operationStatDataContainer}>
                      <View style={styles.operationStatBarContainer}>
                        <View style={[styles.operationStatBar, {
                          width: `${percentage}%`,
                          backgroundColor: getOperationColor(operation)
                        }]} />
            </View>
                      <ThemedText style={styles.operationStatValue}>
                        {count} ({percentage}%)
                      </ThemedText>
                    </View>
                  </View>
                );
              })}
          </View>
        </ThemedView>
        </View>
        
        {/* Filter controls */}
        <View style={styles.filterControlsContainer}>
          <View style={styles.filterLabelContainer}>
            <ThemedText style={styles.filterLabel}>
              Filter by table:
          </ThemedText>
          {tableFilter && (
            <TouchableOpacity 
              style={styles.clearFilterButton}
              onPress={() => setTableFilter('')}
            >
                <ThemedText style={styles.clearFilterText}>Clear</ThemedText>
            </TouchableOpacity>
          )}
        </View>
        
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterButtonsScrollView}>
            <View style={styles.filterButtonsContainer}>
              {Object.keys(stats.tableStats).map(table => (
          <TouchableOpacity 
                  key={table} 
            style={[
                    styles.filterButton,
                    tableFilter === table && {backgroundColor: tableColors[table] || '#666'},
                  ]}
                  onPress={() => setTableFilter(tableFilter === table ? '' : table)}
                >
                  <ThemedText style={[
                    styles.filterButtonText,
                    tableFilter === table && {color: '#FFFFFF'}
                  ]}>
                    {table.replace('user_', '')}
                  </ThemedText>
          </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
        
        {/* Record count info */}
        <View style={styles.recordsInfo}>
          <ThemedText style={styles.recordsInfoText}>
            Showing {recordsToDisplay.length} of {filteredOperations.length} records
            {tableFilter && ` (filtered by "${tableFilter}")`}
          </ThemedText>
          
          {/* Show/hide controls */}
          <View style={styles.recordControlButtons}>
            {showAllRecords ? (
          <TouchableOpacity 
                style={[styles.recordControlButton, {backgroundColor: '#555'}]}
                onPress={() => {
                  setShowAllRecords(false);
                  setVisibleDbRecords(100);
                }}
              >
                <ThemedText style={{color: 'white', fontSize: 12}}>Show Latest 100</ThemedText>
          </TouchableOpacity>
            ) : (
              <TouchableOpacity 
                style={[styles.recordControlButton, {backgroundColor: '#0A7EA4'}]}
                onPress={() => setShowAllRecords(true)}
              >
                <ThemedText style={{color: 'white', fontSize: 12}}>Show All ({filteredOperations.length})</ThemedText>
              </TouchableOpacity>
            )}
            
            {/* Add the Copy button */}
          <TouchableOpacity 
              style={[styles.recordControlButton, {backgroundColor: '#4CAF50', marginLeft: 8}]}
              onPress={prepareDbOperationsText}
            >
              <ThemedText style={{color: 'white', fontSize: 12}}>Copy Log</ThemedText>
          </TouchableOpacity>
          </View>
        </View>
        
        {/* Operations table - enhanced with better visuals */}
        <ThemedView style={styles.enhancedTableContainer}>
          <View style={styles.enhancedTableHeader}>
            <ThemedText style={[styles.enhancedHeaderCell, styles.enhancedTimeCell]}>Time</ThemedText>
            <ThemedText style={[styles.enhancedHeaderCell, styles.enhancedDirectionCell]}>Type</ThemedText>
            <ThemedText style={[styles.enhancedHeaderCell, styles.enhancedTableCell]}>Table</ThemedText>
            <ThemedText style={[styles.enhancedHeaderCell, styles.enhancedActionCell]}>Action</ThemedText>
            <ThemedText style={[styles.enhancedHeaderCell, styles.enhancedOperationCell]}>Operation</ThemedText>
            <ThemedText style={[styles.enhancedHeaderCell, styles.enhancedRecordsCell]}>#</ThemedText>
            <ThemedText style={[styles.enhancedHeaderCell, styles.enhancedStatusCell]}>Status</ThemedText>
            <ThemedText style={[styles.enhancedHeaderCell, styles.enhancedDataCell]}>Data</ThemedText>
          </View>
          
          <ScrollView style={styles.enhancedTableScrollView} nestedScrollEnabled={true}>
            {recordsToDisplay.map((operation, index) => {
              const isError = operation.status === 'error';
              const isSent = operation.direction === 'sent';
              const timestamp = formatTimestamp(operation.timestamp);
              const formattedTime = timestamp.split(' ')[0]; // Just get the time part
              const actionType = getActionType(operation);
              
              return (
              <React.Fragment key={`${operation.timestamp}-${index}`}>
                <TouchableOpacity 
                    style={[
                      styles.enhancedTableRow,
                      index % 2 === 0 && styles.enhancedTableRowAlt,
                      isError && styles.enhancedTableRowError
                    ]}
                    onPress={() => {
                      setExpandedData(prev => 
                        prev === `${operation.timestamp}-${index}` 
                          ? null 
                          : `${operation.timestamp}-${index}`
                      );
                    }}
                  >
                    {/* Time with tooltip showing full timestamp */}
                    <View style={[styles.enhancedCell, styles.enhancedTimeCell]}>
                      <ThemedText style={styles.enhancedTimeText}>{formattedTime}</ThemedText>
                      <ThemedText style={styles.enhancedTimeSubtext}>{timestamp.split(' ')[1]}</ThemedText>
                    </View>
                    
                    {/* Direction with icon */}
                    <View style={[
                      styles.enhancedCell, 
                      styles.enhancedDirectionCell,
                      isSent ? styles.enhancedSentCell : styles.enhancedReceivedCell
                    ]}>
                      <View style={[
                        styles.enhancedDirectionIcon,
                        isSent ? styles.enhancedSentIcon : styles.enhancedReceivedIcon
                      ]}>
                        <ThemedText style={styles.enhancedDirectionIconText}>
                          {isSent ? '↑' : '↓'}
                  </ThemedText>
                      </View>
                      <ThemedText style={styles.enhancedDirectionText}>
                        {isSent ? 'Sent' : 'Rcvd'}
                  </ThemedText>
                    </View>
                    
                    {/* Table name with color coding */}
                    <View style={[styles.enhancedCell, styles.enhancedTableCell]}>
                      <View style={[
                        styles.enhancedTableIndicator,
                        {backgroundColor: tableColors[operation.table] || '#999'}
                      ]}/>
                      <ThemedText 
                        style={styles.enhancedTableText}
                        numberOfLines={1}
                        ellipsizeMode="middle"
                      >
                        {operation.table.replace('user_', '')}
                  </ThemedText>
                    </View>
                    
                    {/* NEW: Action type column */}
                    <View style={[styles.enhancedCell, styles.enhancedActionCell]}>
                      <ThemedText 
                        style={styles.enhancedActionText}
                        numberOfLines={1}
                      >
                        {actionType}
                  </ThemedText>
                    </View>
                    
                    {/* Operation with color coding */}
                    <View style={[styles.enhancedCell, styles.enhancedOperationCell]}>
                  <ThemedText 
                    style={[
                          styles.enhancedOperationText,
                          {color: getOperationColor(operation.operation)}
                    ]}
                  >
                        {operation.operation}
                  </ThemedText>
                    </View>
                    
                    {/* Records count */}
                    <ThemedText style={[styles.enhancedCell, styles.enhancedRecordsCell]}>
                      {operation.records}
                    </ThemedText>
                    
                    {/* Status with color coding */}
                    <View style={[
                      styles.enhancedCell, 
                      styles.enhancedStatusCell,
                    ]}>
                      <View style={[
                        styles.enhancedStatusIndicator,
                        operation.status === 'success' 
                          ? styles.enhancedSuccessIndicator 
                          : styles.enhancedErrorIndicator
                      ]}>
                        <ThemedText style={styles.enhancedStatusText}>
                          {operation.status === 'success' ? 'OK' : 'ERR'}
                        </ThemedText>
                      </View>
                    </View>
                    
                    {/* Data preview */}
                  <TouchableOpacity 
                      style={[styles.enhancedCell, styles.enhancedDataCell]}
                    onPress={() => {
                      setExpandedData(prev => 
                        prev === `${operation.timestamp}-${index}` 
                          ? null 
                          : `${operation.timestamp}-${index}`
                      );
                    }}
                  >
                      <ThemedText style={styles.enhancedDataText}>
                      {expandedData === `${operation.timestamp}-${index}` ? 'Hide' : 'View'}
                    </ThemedText>
                  </TouchableOpacity>
                </TouchableOpacity>
                  
                  {/* Expanded data view */}
                {expandedData === `${operation.timestamp}-${index}` && (
                    <View style={styles.enhancedExpandedDataContainer}>
                      <View style={styles.enhancedExpandedDataHeader}>
                        <ThemedText style={styles.enhancedExpandedDataTitle}>
                          {operation.operation.toUpperCase()} to {operation.table}
                        </ThemedText>
                        {operation.error && (
                          <ThemedText style={styles.enhancedExpandedDataError}>
                            Error: {operation.error}
                          </ThemedText>
                        )}
                      </View>
                      <ScrollView style={styles.enhancedDataScrollView} horizontal={true}>
                        <ThemedText style={styles.enhancedDataJsonText}>
                        {JSON.stringify(operation.data, null, 2)}
                      </ThemedText>
                    </ScrollView>
                  </View>
                )}
              </React.Fragment>
              );
            })}
            
            {filteredOperations.length === 0 && (
              <View style={styles.enhancedEmptyState}>
                <ThemedText style={styles.enhancedEmptyText}>
                  {tableFilter ? `No records found for table "${tableFilter}"` : 'No database operations logged yet'}
                </ThemedText>
              </View>
            )}
          </ScrollView>
          
          {/* Load more button */}
          {!showAllRecords && filteredOperations.length > visibleDbRecords && (
              <TouchableOpacity 
              style={styles.enhancedLoadMoreButton}
                onPress={() => setVisibleDbRecords(prev => prev + 100)}
              >
              <ThemedText style={styles.enhancedLoadMoreText}>
                Load 100 More
              </ThemedText>
            </TouchableOpacity>
          )}
        </ThemedView>
      </ScrollView>
    );
  };
  
  // Add state for database debugging
  const [dbDebugResults, setDbDebugResults] = useState<any>(null);
  const [isFixingDb, setIsFixingDb] = useState<boolean>(false);

  // Add function to debug database
  const debugDatabase = async () => {
    if (user?.id) {
      try {
        console.log('InteractionTracker: Debugging database');
        const dbInfo = await getDatabaseInfo();
        setDbDebugResults(dbInfo);
        console.log('InteractionTracker: Database debug results:', dbInfo);
      } catch (error) {
        console.error('InteractionTracker: Error debugging database:', error);
      }
    }
  };
  
  // Add function to attempt database fix
  const fixDatabase = async () => {
    if (user?.id) {
      try {
        setIsFixingDb(true);
        console.log('InteractionTracker: Attempting to fix database');
        const fixResult = await attemptDatabaseFix(user.id);
        console.log('InteractionTracker: Database fix result:', fixResult);
        
        // Re-run debugger to see changes
        await debugDatabase();
        
        // Refresh weights from database
        await loadWeightsFromDB();
      } catch (error) {
        console.error('InteractionTracker: Error fixing database:', error);
      } finally {
        setIsFixingDb(false);
      }
    }
  };
  
  // Render the weights tab
  const renderWeightsTab = () => {
    // Get all topic weights for debugging
    const allTopicWeights = Object.entries(userProfile.topics).map(([topic, data]) => ({
      topic,
      weight: data.weight,
      isDefault: Math.abs(data.weight - 0.5) < 0.001 // Check if it's the default weight (with small epsilon for floating point comparison)
    }));
    
    return (
      <ScrollView style={styles.tabScrollView}>
        <ThemedView style={styles.statsCard}>
          <ThemedText style={styles.statsCardTitle}>Topic Weights Tracking</ThemedText>
          <ThemedText style={styles.statsSubtitle}>
            See how topic weights change as you interact with questions
          </ThemedText>
        </ThemedView>

        {/* Debug section to show raw weight values */}
        <ThemedView style={styles.currentWeightsContainer}>
          <ThemedText style={styles.sectionTitle}>Debug Raw Weights</ThemedText>
          
          {/* Add this debug weights summary component */}
          <ThemedView style={styles.debugWeightsSummary}>
            <ThemedText style={styles.debugWeightsHeader}>Topic Weights Summary</ThemedText>
            
            <ThemedText style={styles.debugWeightsInfo}>
              Default Weight: <ThemedText style={{fontWeight: 'bold', color: '#FFD700'}}>0.50</ThemedText>
            </ThemedText>
            
            <ThemedText style={styles.debugWeightsInfo}>
              Total Topics: {Object.keys(userProfile.topics || {}).length}
            </ThemedText>
            
            <ThemedText style={styles.debugWeightsInfo}>
              Weights Distribution: {
                Object.entries(userProfile.topics || {}).reduce((counts, [_, data]) => {
                  if (Math.abs(data.weight - 0.5) < 0.001) counts.default++;
                  else if (data.weight > 0.5) counts.increased++;
                  else counts.decreased++;
                  return counts;
                }, {default: 0, increased: 0, decreased: 0}).default
              } default / {
                Object.entries(userProfile.topics || {}).reduce((counts, [_, data]) => {
                  if (Math.abs(data.weight - 0.5) < 0.001) counts.default++;
                  else if (data.weight > 0.5) counts.increased++;
                  else counts.decreased++;
                  return counts;
                }, {default: 0, increased: 0, decreased: 0}).increased
              } increased / {
                Object.entries(userProfile.topics || {}).reduce((counts, [_, data]) => {
                  if (Math.abs(data.weight - 0.5) < 0.001) counts.default++;
                  else if (data.weight > 0.5) counts.increased++;
                  else counts.decreased++;
                  return counts;
                }, {default: 0, increased: 0, decreased: 0}).decreased
              } decreased
            </ThemedText>
          </ThemedView>
          
          {allTopicWeights.map(({ topic, weight, isDefault }) => (
            <View key={`debug-${topic}`} style={styles.weightItem}>
              <ThemedText style={styles.weightLabel}>{topic}</ThemedText>
                    <ThemedText style={[
                styles.weightValue, 
                isDefault ? { color: '#FFD700' } : // Gold for default
                weight > 0.5 ? { color: '#4CAF50' } : // Green for increased
                { color: '#FF5252' } // Red for decreased
              ]}>
                {weight.toFixed(2)} 
                <ThemedText style={{fontSize: 12, opacity: 0.8}}>
                  {isDefault ? " [DEFAULT]" : 
                   weight > 0.5 ? " [INCREASED]" : 
                   " [DECREASED]"}
                </ThemedText>
                    </ThemedText>
                  </View>
                ))}
          <ThemedText style={[styles.lastUpdatedText, {textAlign: 'center', marginTop: 10}]}>
            <ThemedText style={{color: '#FFD700'}}>● Gold = Default (0.50)</ThemedText> | 
            <ThemedText style={{color: '#4CAF50'}}> ● Green = Increased</ThemedText> | 
            <ThemedText style={{color: '#FF5252'}}> ● Red = Decreased</ThemedText>
          </ThemedText>
        </ThemedView>

        {/* Current Weights section - Client-side only */}
        <ThemedView style={styles.currentWeightsContainer}>
          <View style={styles.currentWeightsHeader}>
            <ThemedText style={styles.sectionTitle}>Current Client-Side Weights</ThemedText>
              </View>
              
          <View style={styles.lastUpdatedContainer}>
            <ThemedText style={styles.lastUpdatedText}>
              Last Updated: {new Date(userProfile.lastRefreshed).toLocaleTimeString()}
                  </ThemedText>
                </View>
                  
          {/* Rest of the existing weights display */}
          {Object.entries(userProfile.topics || {}).length > 0 ? (
            <ScrollView style={{maxHeight: 100}} nestedScrollEnabled={true}>
              {Object.entries(userProfile.topics).map(([topicName, topic]) => (
                <ThemedText key={topicName} style={{fontSize: 12, color: '#333333', marginBottom: 4}}>
                  {topicName}: {topic.weight.toFixed(4)}, 
                  Subtopics: {Object.entries(topic.subtopics).map(([subName, sub]) => 
                    `${subName}=${sub.weight.toFixed(4)}`).join(', ')}
                          </ThemedText>
              ))}
            </ScrollView>
          ) : (
            <ThemedText style={{fontSize: 12, color: '#666666'}}>
              No topics found
                </ThemedText>
              )}
            </ThemedView>
        
        {/* Rest of the existing weights display */}
        <ThemedView style={styles.weightChangesContainer}>
          <ThemedText style={styles.sectionTitle}>Recent Weight Changes</ThemedText>
          
          {/* Debug info for weight changes */}
          <ThemedView style={{backgroundColor: 'rgba(255, 215, 0, 0.1)', padding: 10, borderRadius: 5, marginBottom: 10}}>
            <ThemedText style={{fontSize: 12, color: '#333333', fontWeight: 'bold'}}>
              Debug Info
                    </ThemedText>
            <ThemedText style={{fontSize: 11, color: '#666666'}}>
              Default weight value: 0.50
                          </ThemedText>
            <ThemedText style={{fontSize: 11, color: '#666666'}}>
              Displayed weights might not match actual values due to display formatting
                                  </ThemedText>
            <ThemedText style={{fontSize: 11, color: '#666666'}}>
              The 'Debug Raw Weights' panel above shows the actual current weights
          </ThemedText>
        </ThemedView>
        
          {weightChanges.length === 0 ? (
            <View style={styles.emptyState}>
              <ThemedText style={styles.emptyText}>No weight changes recorded yet</ThemedText>
            </View>
          ) : (
            weightChanges.slice().reverse().map((change, index) => (
              <View key={index} style={styles.weightChangeItem}>
                <View style={styles.weightChangeHeader}>
                  <ThemedText style={styles.weightChangeCategory}>
                    {change.topic} {change.subtopic ? `> ${change.subtopic}` : ''}
                    {change.branch ? `> ${change.branch}` : ''}
                  </ThemedText>
                  <View style={styles.weightChangeInfo}>
                    <ThemedText style={[
                      styles.weightChangeType, 
                      change.interactionType === 'correct' ? styles.correctText : 
                      change.interactionType === 'incorrect' ? styles.incorrectText : 
                      change.interactionType === 'skipped' ? styles.skippedText : 
                      styles.skippedText
                    ]}>
                      {change.interactionType.toUpperCase()}
                    </ThemedText>
                    <ThemedText style={styles.weightChangeTime}>
                      {new Date(change.timestamp).toLocaleTimeString()}
                    </ThemedText>
                  </View>
                </View>
                
                <ThemedText style={styles.weightChangeQuestion}>
                  {change.questionText || `Question ${change.questionId.substring(0, 8)}...`}
                </ThemedText>
                
                <View style={styles.weightTable}>
                  <View style={styles.weightTableHeader}>
                    <ThemedText style={[styles.weightTableCell, styles.weightTableHeaderText]}>Weight Type</ThemedText>
                    <ThemedText style={[styles.weightTableCell, styles.weightTableHeaderText]}>Before</ThemedText>
                    <ThemedText style={[styles.weightTableCell, styles.weightTableHeaderText]}>After</ThemedText>
                    <ThemedText style={[styles.weightTableCell, styles.weightTableHeaderText]}>Change</ThemedText>
                  </View>
                  
                  <View style={styles.weightTableRow}>
                    <ThemedText style={styles.weightTableCell}>Topic</ThemedText>
                    <ThemedText style={[
                      styles.weightTableCell,
                      isDefaultWeight(change.oldWeights.topicWeight) ? {fontStyle: 'italic'} : {}
                    ]}>
                      {formatWeight(change.oldWeights.topicWeight)}
                    </ThemedText>
                    <ThemedText style={[
                      styles.weightTableCell,
                      isDefaultWeight(change.newWeights.topicWeight) ? {fontStyle: 'italic'} : {}
                    ]}>
                      {formatWeight(change.newWeights.topicWeight)}
                    </ThemedText>
                    <ThemedText 
                      style={[
                        styles.weightTableCell, 
                        change.newWeights.topicWeight > change.oldWeights.topicWeight 
                          ? styles.weightIncreaseText 
                          : styles.weightDecreaseText
                      ]}
                    >
                      {(change.newWeights.topicWeight - change.oldWeights.topicWeight) > 0 ? '+' : ''}
                      {(change.newWeights.topicWeight - change.oldWeights.topicWeight).toFixed(2)}
                    </ThemedText>
                  </View>
                  
                  {change.oldWeights.subtopicWeight !== undefined && 
                   change.newWeights.subtopicWeight !== undefined && (
                    <View style={styles.weightTableRow}>
                      <ThemedText style={styles.weightTableCell}>Subtopic</ThemedText>
                      <ThemedText style={[
                        styles.weightTableCell,
                        isDefaultWeight(change.oldWeights.subtopicWeight) ? {fontStyle: 'italic'} : {}
                      ]}>
                        {formatWeight(change.oldWeights.subtopicWeight)}
                      </ThemedText>
                      <ThemedText style={[
                        styles.weightTableCell,
                        isDefaultWeight(change.newWeights.subtopicWeight) ? {fontStyle: 'italic'} : {}
                      ]}>
                        {formatWeight(change.newWeights.subtopicWeight)}
                      </ThemedText>
                      <ThemedText 
                        style={[
                          styles.weightTableCell, 
                          change.newWeights.subtopicWeight > change.oldWeights.subtopicWeight 
                            ? styles.weightIncreaseText 
                            : styles.weightDecreaseText
                        ]}
                      >
                        {(change.newWeights.subtopicWeight - change.oldWeights.subtopicWeight) > 0 ? '+' : ''}
                        {(change.newWeights.subtopicWeight - change.oldWeights.subtopicWeight).toFixed(2)}
                      </ThemedText>
                    </View>
                  )}
                  
                  {change.oldWeights.branchWeight !== undefined && 
                   change.newWeights.branchWeight !== undefined && (
                    <View style={styles.weightTableRow}>
                      <ThemedText style={styles.weightTableCell}>Branch</ThemedText>
                      <ThemedText style={[
                        styles.weightTableCell,
                        isDefaultWeight(change.oldWeights.branchWeight) ? {fontStyle: 'italic'} : {}
                      ]}>
                        {formatWeight(change.oldWeights.branchWeight)}
                      </ThemedText>
                      <ThemedText style={[
                        styles.weightTableCell,
                        isDefaultWeight(change.newWeights.branchWeight) ? {fontStyle: 'italic'} : {}
                      ]}>
                        {formatWeight(change.newWeights.branchWeight)}
                      </ThemedText>
                      <ThemedText 
                        style={[
                          styles.weightTableCell, 
                          change.newWeights.branchWeight > change.oldWeights.branchWeight 
                            ? styles.weightIncreaseText 
                            : styles.weightDecreaseText
                        ]}
                      >
                        {(change.newWeights.branchWeight - change.oldWeights.branchWeight) > 0 ? '+' : ''}
                        {(change.newWeights.branchWeight - change.oldWeights.branchWeight).toFixed(2)}
                      </ThemedText>
                    </View>
                  )}
                </View>
              </View>
            ))
          )}
        </ThemedView>
      </ScrollView>
    );
  };
  
  // Helper function to format timestamp
  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    return `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}.${date.getMilliseconds()}`;
  };
  
  // Listen for question generation events
  useEffect(() => {
    // Create a function to handle generator events
    const handleGeneratorEvent = (event: GeneratorEvent) => {
      setGeneratorEvents(prev => [event, ...prev]);
    };

    // Subscribe to generator events
    dbEventEmitter.addListener('generatorEvent', handleGeneratorEvent);

    // Clean up
    return () => {
      dbEventEmitter.removeListener('generatorEvent', handleGeneratorEvent);
    };
  }, []);
  
  // Add a new function to render the generator tab
  const renderGeneratorTab = () => {
    // Filter out events with 'checking' status for a cleaner UI display
    const filteredEvents = generatorEvents.filter(event => event.status !== 'checking')
      // Sort by timestamp descending (newest first)
      .sort((a, b) => b.timestamp - a.timestamp);
    
    // Helper function to extract and format the generation reason from status
    const extractGenerationReason = (event: GeneratorEvent): string | null => {
      if (!event.status) return null;
      
      const statusParts = event.status.split(' - ');
      if (statusParts.length < 2) return null;
      
      return statusParts[1]; // The part after " - " is the reason
    };
    
    // Helper to get event type from status 
    const getEventStage = (event: GeneratorEvent): string => {
      if (!event.status) return event.success ? 'Completed' : 'Failed';
      
      if (event.status.startsWith('starting')) return 'Started';
      if (event.status.startsWith('completed')) return 'Completed';
      return event.success ? 'Completed' : 'Failed';
    };
    
    return (
      <ScrollView style={styles.scrollView}>
        <ThemedView style={{ padding: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 }}>
            <ThemedText style={{ fontWeight: 'bold', fontSize: 16, color: '#333333' }}>
              Question Generation Events
            </ThemedText>
            <ThemedText style={{ fontSize: 12, color: '#666666' }}>
              {filteredEvents.length} events
            </ThemedText>
          </View>

          {filteredEvents.length === 0 ? (
            <ThemedText style={{ color: '#666666', fontSize: 14, fontStyle: 'italic', textAlign: 'center', marginTop: 20 }}>
              No question generation events recorded yet
            </ThemedText>
          ) : (
            filteredEvents.map((event, index) => (
              <View key={index} style={{
                padding: 12,
                marginBottom: 10,
                borderRadius: 8,
                backgroundColor: 'rgba(240, 240, 240, 0.5)',
                borderWidth: 1,
                borderColor: event.success ? '#4CAF50' : 
                  event.status?.startsWith('starting') ? '#2196F3' : '#F44336',
                borderLeftWidth: 3,
              }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <ThemedText style={{ 
                    fontWeight: 'bold', 
                    fontSize: 14, 
                    color: event.success ? '#4CAF50' : 
                      event.status?.startsWith('starting') ? '#2196F3' : '#F44336'
                  }}>
                    {getEventStage(event)}
                    {event.success && event.questionsSaved > 0 && `: ${event.questionsSaved} questions`}
                  </ThemedText>
                  <ThemedText style={{ fontSize: 12, color: '#666666' }}>
                    {formatTimestamp(event.timestamp)}
                  </ThemedText>
                </View>
                
                {/* Add reason info if available */}
                {extractGenerationReason(event) && (
                  <View style={{ marginBottom: 8, backgroundColor: 'rgba(25, 118, 210, 0.1)', padding: 8, borderRadius: 4 }}>
                    <ThemedText style={{ fontSize: 13, color: '#1976D2', fontWeight: '500' }}>
                      Reason: {extractGenerationReason(event)}
                    </ThemedText>
                  </View>
                )}

                {(event.primaryTopics.length > 0 || event.adjacentTopics.length > 0) && (
                  <View style={{ marginBottom: 8 }}>
                    {event.primaryTopics.length > 0 && (
                      <ThemedText style={{ fontSize: 13, color: '#333333', marginBottom: 4 }}>
                        <ThemedText style={{ fontWeight: 'bold' }}>Topics:</ThemedText>{' '}
                        {event.primaryTopics.join(', ')}
                      </ThemedText>
                    )}
                    
                    {event.adjacentTopics.length > 0 && (
                      <ThemedText style={{ fontSize: 13, color: '#333333' }}>
                        <ThemedText style={{ fontWeight: 'bold' }}>Adjacent:</ThemedText>{' '}
                        {event.adjacentTopics.join(', ')}
                      </ThemedText>
                    )}
                  </View>
                )}

                {/* Only show counts if they're more than 0 */}
                {(event.questionsGenerated > 0 || event.questionsSaved > 0) && (
                  <View style={{ flexDirection: 'row', marginBottom: 8 }}>
                    {event.questionsGenerated > 0 && (
                      <View style={{ flex: 1 }}>
                        <ThemedText style={{ fontSize: 13, color: '#333333' }}>
                          <ThemedText style={{ fontWeight: 'bold' }}>Generated:</ThemedText>{' '}
                          {event.questionsGenerated}
                        </ThemedText>
                      </View>
                    )}
                    {event.questionsSaved > 0 && (
                      <View style={{ flex: 1 }}>
                        <ThemedText style={{ fontSize: 13, color: '#333333' }}>
                          <ThemedText style={{ fontWeight: 'bold' }}>Saved:</ThemedText>{' '}
                          {event.questionsSaved}
                        </ThemedText>
                      </View>
                    )}
                  </View>
                )}

                {event.error && (
                  <View style={{ marginTop: 5, padding: 8, backgroundColor: 'rgba(244, 67, 54, 0.1)', borderRadius: 4 }}>
                    <ThemedText style={{ fontSize: 12, color: '#F44336' }}>
                      {event.error}
                    </ThemedText>
                  </View>
                )}
              </View>
            ))
          )}
        </ThemedView>
      </ScrollView>
    );
  };
  
  // Return a modified rendering for a light mode UI
  return (
    <>
      {visible && (
        <ThemedView 
          style={[styles.container, {backgroundColor: '#FFFFFF'}]} 
          lightColor="#FFFFFF" 
          darkColor="#FFFFFF"
        >
          <View style={[styles.header, {borderBottomColor: '#e0e0e0'}]}>
            <ThemedText style={[styles.title, {color: '#333333'}]}>Debug Panel</ThemedText>
            <TouchableOpacity onPress={() => setVisible(false)}>
              <Feather name="x" size={24} color="#333333" />
            </TouchableOpacity>
          </View>
          
          <View style={[styles.tabs, {borderBottomColor: '#e0e0e0'}]}>
            <TouchableOpacity 
              style={[styles.tab, activeTab === 'interactions' && [styles.activeTab, {borderBottomColor: '#3498db'}]]} 
              onPress={() => setActiveTab('interactions')}
            >
              <ThemedText style={[styles.tabText, {color: '#333333'}, activeTab === 'interactions' && {color: '#3498db'}]}>
                Interactions
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.tab, activeTab === 'feed' && [styles.activeTab, {borderBottomColor: '#3498db'}]]} 
              onPress={() => setActiveTab('feed')}
            >
              <ThemedText style={[styles.tabText, {color: '#333333'}, activeTab === 'feed' && {color: '#3498db'}]}>
                Feed Status
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.tab, activeTab === 'feedList' && [styles.activeTab, {borderBottomColor: '#3498db'}]]} 
              onPress={() => setActiveTab('feedList')}
            >
              <ThemedText style={[styles.tabText, {color: '#333333'}, activeTab === 'feedList' && {color: '#3498db'}]}>
                Feed List
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.tab, activeTab === 'dbLog' && [styles.activeTab, {borderBottomColor: '#3498db'}]]} 
              onPress={() => setActiveTab('dbLog')}
            >
              <ThemedText style={[styles.tabText, {color: '#333333'}, activeTab === 'dbLog' && {color: '#3498db'}]}>
                DB Log
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.tab, activeTab === 'weights' && [styles.activeTab, {borderBottomColor: '#3498db'}]]} 
              onPress={() => setActiveTab('weights')}
            >
              <ThemedText style={[styles.tabText, {color: '#333333'}, activeTab === 'weights' && {color: '#3498db'}]}>
                Weights
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.tab, activeTab === 'generator' && [styles.activeTab, {borderBottomColor: '#3498db'}]]} 
              onPress={() => setActiveTab('generator')}
            >
              <ThemedText style={[styles.tabText, {color: '#333333'}, activeTab === 'generator' && {color: '#3498db'}]}>
                Generator
              </ThemedText>
            </TouchableOpacity>
          </View>
          
          {activeTab === 'interactions' ? renderInteractionsTab() : 
           activeTab === 'feed' ? renderFeedStatusTab() : 
           activeTab === 'feedList' ? renderFeedListTab() : 
           activeTab === 'dbLog' ? renderDbLogTab() :
           activeTab === 'generator' ? renderGeneratorTab() :
           renderWeightsTab()}
        </ThemedView>
      )}
      
      {!visible && (
        <TouchableOpacity 
          style={[
            styles.toggleButton, 
            Platform.OS === 'ios' ? styles.iosToggleButton : {backgroundColor: '#FFFFFF'},
          ]} 
          onPress={() => setVisible(true)}
        >
          <Feather 
            name="activity" 
            size={24} 
            color={Platform.OS === 'ios' ? "#FFFFFF" : "#333333"} 
          />
        </TouchableOpacity>
      )}
    </>
  );
}

// Update container style to ensure light mode appearance
const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 50,
    right: 10,
    width: '95%',
    maxWidth: 500,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    maxHeight: '80%',
    zIndex: 1000,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    paddingBottom: 8,
  },
  title: {
    color: '#333333',
    fontSize: 18,
    fontWeight: 'bold',
  },
  tabs: {
    flexDirection: 'row',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginRight: 5,
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#3498db',
  },
  tabText: {
    color: '#333333',
    fontSize: 14,
  },
  scrollView: {
    flex: 1,
  },
  toggleButton: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 60 : 10, // Adjust position for iOS to avoid the home indicator
    right: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  interactionRow: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  feedRow: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  explanations: {
    marginTop: 5,
    paddingLeft: 10,
  },
  explanationText: {
    color: '#666666',
    fontSize: 12,
    marginBottom: 2,
  },
  correctText: {
    color: '#2ecc71',
  },
  incorrectText: {
    color: '#e74c3c',
  },
  skippedText: {
    color: '#f39c12',
  },
  itemId: {
    color: '#333333',
    fontWeight: 'bold',
    marginBottom: 2,
  },
  questionText: {
    color: '#333333',
    marginBottom: 5,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  infoLabel: {
    color: '#666666',
    fontSize: 12,
    width: 80,
  },
  infoValue: {
    color: '#333333',
    fontSize: 12,
    flex: 1,
  },
  timestamp: {
    color: '#999999',
    fontSize: 10,
    textAlign: 'right',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 10,
    backgroundColor: 'rgba(240, 240, 240, 0.5)',
    borderRadius: 5,
    marginBottom: 10,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    color: '#333333',
    fontSize: 18,
    fontWeight: 'bold',
  },
  statLabel: {
    color: '#333333',
    fontSize: 12,
  },
  // Table styles for database log
  tableContainer: {
    marginBottom: 10,
    borderRadius: 5,
    overflow: 'hidden',
    maxHeight: 2000,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: 'rgba(52, 152, 219, 0.2)',
    paddingVertical: 8,
    paddingHorizontal: 5,
  },
  headerCell: {
    color: '#333333',
    fontWeight: 'bold',
    fontSize: 12,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
    paddingVertical: 8,
    paddingHorizontal: 5,
  },
  cell: {
    color: '#333333',
    fontSize: 11,
  },
  timeCell: {
    width: 80,
  },
  directionCell: {
    width: 70,
    textAlign: 'center',
  },
  tableCell: {
    width: 100,
  },
  operationCell: {
    width: 70,
  },
  recordsCell: {
    width: 50,
    textAlign: 'center',
  },
  statusCell: {
    flex: 1,
    textAlign: 'center',
  },
  sentText: {
    color: '#f39c12', // Orange for sent
  },
  receivedText: {
    color: '#3498db', // Blue for received
  },
  successText: {
    color: '#2ecc71', // Green for success
  },
  errorText: {
    color: '#e74c3c', // Red for error
  },
  emptyState: {
    padding: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(240, 240, 240, 0.5)',
    borderRadius: 8,
    marginVertical: 5,
  },
  emptyText: {
    color: '#333333',
    fontStyle: 'italic',
    textAlign: 'center',
  },
  tabsContainer: {
    flexDirection: 'row',
    marginBottom: 12,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
  },
  activeTabText: {
    color: '#3498db',
    fontWeight: 'bold',
  },
  summaryContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(240, 240, 240, 0.5)',
  },
  interactionsContainer: {
    marginBottom: 20,
  },
  logItem: {
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
  },
  correctLog: {
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    borderLeftWidth: 3,
    borderLeftColor: '#4CAF50',
  },
  incorrectLog: {
    backgroundColor: 'rgba(244, 67, 54, 0.1)',
    borderLeftWidth: 3,
    borderLeftColor: '#F44336',
  },
  skippedLog: {
    backgroundColor: 'rgba(255, 152, 0, 0.1)',
    borderLeftWidth: 3,
    borderLeftColor: '#FF9800',
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  logType: {
    fontWeight: 'bold',
    fontSize: 12,
    color: '#333333',
  },
  logTime: {
    fontSize: 12,
    opacity: 0.7,
    color: '#666666',
  },
  profileChangesContainer: {
    marginBottom: 20,
  },
  profileChangeItem: {
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(10, 126, 164, 0.1)',
    borderLeftWidth: 3,
    borderLeftColor: '#0A7EA4',
  },
  changeText: {
    fontSize: 14,
    marginBottom: 4,
    color: '#333333',
  },
  feedListContainer: {
    marginBottom: 20,
  },
  feedChangesContainer: {
    marginBottom: 20,
  },
  feedChangeItem: {
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(10, 126, 164, 0.1)',
    borderLeftWidth: 3,
    borderLeftColor: '#0A7EA4',
  },
  explanationContainer: {
    marginTop: 8,
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(10, 126, 164, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(10, 126, 164, 0.2)',
  },
  explanationHeader: {
    fontWeight: 'bold',
    marginBottom: 6,
    fontSize: 12,
    color: '#0A7EA4',
  },
  weightFactorsContainer: {
    backgroundColor: 'rgba(10, 126, 164, 0.1)',
    padding: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  weightFactorText: {
    fontSize: 12,
    marginBottom: 4,
    color: '#444',
  },
  weightValue: {
    fontWeight: 'bold',
    fontSize: 14,
    color: '#333333',
  },
  allFeedItemsContainer: {
    marginBottom: 20,
  },
  feedItem: {
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(10, 126, 164, 0.1)',
    borderLeftWidth: 3,
    borderLeftColor: '#0A7EA4',
  },
  feedItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  feedItemNumber: {
    fontWeight: 'bold',
    fontSize: 12,
    color: '#333333',
  },
  feedItemTopic: {
    fontSize: 12,
    color: '#666666',
  },
  feedItemText: {
    fontSize: 14,
    color: '#333333',
  },
  tagsContainer: {
    flexDirection: 'row',
    marginTop: 4,
  },
  tag: {
    padding: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(10, 126, 164, 0.1)',
    marginRight: 4,
  },
  tagText: {
    fontSize: 12,
    color: '#333333',
  },
  explanationButton: {
    marginTop: 8,
    padding: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(10, 126, 164, 0.15)',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(10, 126, 164, 0.3)',
  },
  explanationButtonText: {
    color: '#0A7EA4',
    fontWeight: 'bold',
    fontSize: 12,
  },
  feedHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10, 126, 164, 0.3)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(10, 126, 164, 0.5)',
  },
  refreshText: {
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 4,
    color: '#333333',
  },
  refreshingText: {
    color: '#666666',
    fontSize: 12,
    marginLeft: 4,
  },
  statusSection: {
    marginBottom: 16,
  },
  statusLabel: {
    fontWeight: 'bold',
    marginBottom: 4,
    color: '#333333',
  },
  statusValue: {
    fontSize: 16,
    color: '#333333',
  },
  statusSubtext: {
    fontSize: 12,
    opacity: 0.7,
    marginTop: 4,
    color: '#666666',
  },
  progressBar: {
    height: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    borderRadius: 4,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  coldStartProgress: {
    backgroundColor: '#FF9800',
  },
  personalizedProgress: {
    backgroundColor: '#4CAF50',
  },
  interestItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 6,
  },
  interestName: {
    width: 90,
    fontSize: 13,
    color: '#333333',
  },
  interestBar: {
    flex: 1,
    height: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    borderRadius: 4,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  interestFill: {
    height: '100%',
    backgroundColor: '#0A7EA4',
    borderRadius: 4,
  },
  interestScore: {
    width: 30,
    fontSize: 12,
    textAlign: 'right',
    color: '#333333',
  },
  preferenceItem: {
    flexDirection: 'row',
    marginVertical: 4,
  },
  preferenceName: {
    width: 90,
    fontSize: 13,
    color: '#333333',
  },
  preferenceValue: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#333333',
  },
  statsCard: {
    margin: 10,
    padding: 15,
    borderRadius: 8,
    backgroundColor: 'rgba(10, 126, 164, 0.2)',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  statsCardTitle: {
    color: '#333333',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  statsSubtitle: {
    color: '#666666',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
  detailedStats: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.1)',
  },
  detailedStatsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 8,
  },
  detailedStatsContent: {
    marginTop: 5,
  },
  detailedStatItem: {
    flexDirection: 'row',
    width: '50%',
    marginBottom: 3,
  },
  detailedStatLabel: {
    color: '#666666',
    fontSize: 11,
    marginRight: 5,
  },
  detailedStatValue: {
    color: '#333333',
    fontSize: 11,
    fontWeight: 'bold',
  },
  dataCell: {
    width: 60,
    alignItems: 'center',
  },
  expandedDataContainer: {
    padding: 10,
    backgroundColor: 'rgba(240, 240, 240, 0.5)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  dataScrollView: {
    maxHeight: 200,
  },
  dataText: {
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#333333',
  },
  tabScrollView: {
    flex: 1,
    width: '100%',
  },
  logQuestion: {
    fontSize: 13,
    color: '#333333',
    marginVertical: 2,
  },
  logTimeSpent: {
    fontSize: 11,
    color: '#333333',
    fontStyle: 'italic',
  },
  feedStatusContainer: {
    padding: 10,
    marginBottom: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333',
    marginVertical: 10,
  },
  tableStatDataContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  tableStatBarContainer: {
    flex: 1,
    height: 8,
    backgroundColor: '#f0f0f0',
    borderRadius: 4,
    overflow: 'hidden',
    marginRight: 8,
  },
  tableStatBar: {
    height: 8,
    borderRadius: 4,
  },
  tableStatValue: {
    fontSize: 11,
    color: '#333333',
    minWidth: 50,
    textAlign: 'right',
  },
  selectedTableFilterText: {
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  statsDistributionCard: {
    padding: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginBottom: 10,
  },
  operationStatItem: {
    marginBottom: 5,
  },
  operationStatLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  operationStatDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  operationStatLabel: {
    fontSize: 11,
    color: '#333333',
  },
  operationStatDataContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  operationStatBarContainer: {
    flex: 1,
    height: 6,
    backgroundColor: '#f0f0f0',
    borderRadius: 3,
    overflow: 'hidden',
    marginRight: 8,
  },
  operationStatBar: {
    height: 6,
    borderRadius: 3,
  },
  operationStatValue: {
    fontSize: 10,
    color: '#333333',
    minWidth: 50,
    textAlign: 'right',
  },
  weightChangesContainer: {
    marginTop: 10,
    marginBottom: 15,
  },
  weightChangeItem: {
    marginBottom: 12,
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(240, 240, 240, 0.5)',
    borderLeftWidth: 3,
    borderLeftColor: '#0A7EA4',
    borderWidth: 1,
    borderTopColor: 'transparent',
    borderRightColor: 'rgba(0, 0, 0, 0.1)',
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  weightChangeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  weightChangeCategory: {
    fontWeight: 'bold',
    fontSize: 14,
    color: '#333333',
  },
  weightChangeInfo: {
    flexDirection: 'row',
  },
  weightChangeType: {
    fontWeight: 'bold',
    fontSize: 12,
    marginRight: 8,
  },
  weightChangeTime: {
    fontSize: 12,
    color: '#666666',
  },
  weightChangeQuestion: {
    fontSize: 13,
    marginBottom: 10,
    fontStyle: 'italic',
    color: '#666666',
  },
  weightTable: {
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  weightTableHeader: {
    flexDirection: 'row',
    backgroundColor: 'rgba(240, 240, 240, 0.7)',
  },
  weightTableRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.1)',
  },
  weightTableCell: {
    padding: 6,
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    color: '#333333',
  },
  weightTableHeaderText: {
    fontWeight: 'bold',
    color: '#333333',
  },
  weightIncreaseText: {
    color: '#4CAF50',
    fontWeight: 'bold',
  },
  weightDecreaseText: {
    color: '#F44336',
    fontWeight: 'bold',
  },
  currentWeightsContainer: {
    marginVertical: 15,
    backgroundColor: 'rgba(240, 240, 240, 0.5)',
    borderRadius: 12,
    padding: 15,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginVertical: 10,
    color: '#333333',
  },
  topicWeightItem: {
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#4CAF50',
    paddingLeft: 10,
  },
  topicName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 5,
  },
  subtopicWeightItem: {
    marginLeft: 15,
    marginBottom: 8,
    borderLeftWidth: 2,
    borderLeftColor: '#2196F3',
    paddingLeft: 10,
  },
  subtopicName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#333333',
    marginBottom: 3,
  },
  branchWeightItem: {
    marginLeft: 15,
    marginBottom: 4,
    paddingLeft: 10,
  },
  branchName: {
    fontSize: 14,
    color: '#333333',
  },
  lastUpdatedContainer: {
    marginTop: 4,
  },
  lastUpdatedText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 4,
    textAlign: 'center',
  },
  weightHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  weightValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  weightInfoRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  percentageContainer: {
    padding: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    marginRight: 8,
  },
  percentageText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#333333',
  },
  trendsText: {
    fontSize: 12,
    color: '#666666',
  },
  subtopicPercentage: {
    padding: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    marginRight: 8,
  },
  branchPercentage: {
    padding: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    marginRight: 8,
  },
  trendContainer: {
    marginLeft: 8,
  },
  currentWeightsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  debugResultsContainer: {
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(240, 240, 240, 0.5)',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  debugResultsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  debugResultsTitle: {
    color: '#333333',
    fontSize: 14,
    fontWeight: 'bold',
  },
  tableExistsContainer: {
    marginBottom: 10,
  },
  tableExistsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  tableNameText: {
    color: '#333333',
    fontSize: 12,
  },
  tableExistsText: {
    color: '#333333',
    fontSize: 12,
    fontWeight: 'bold',
  },
  tableExistsTrue: {
    color: '#4CAF50',
  },
  tableExistsFalse: {
    color: '#F44336',
  },
  debugSectionTitle: {
    color: '#333333',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  debugDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    paddingHorizontal: 10,
  },
  debugDetailText: {
    fontSize: 12,
    color: '#666666',
  },
  debugErrorText: {
    fontSize: 12,
    color: '#ff6b6b',
  },
  debugSuccessText: {
    fontSize: 12,
    color: '#4CAF50',
  },
  debugInfoMessage: {
    fontSize: 13,
    color: '#5b6ae8',
    margin: 10,
    textAlign: 'center',
  },
  columnInfoContainer: {
    marginTop: 10,
    padding: 10,
    backgroundColor: 'rgba(240, 240, 240, 0.5)',
    borderRadius: 6,
  },
  columnInfoTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 6,
  },
  columnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  columnName: {
    fontSize: 12,
    color: '#333333',
  },
  columnType: {
    fontSize: 12,
    color: '#855A00',
  },
  refreshProgressText: {
    fontSize: 12,
    color: '#666666',
    fontStyle: 'italic',
    alignSelf: 'center',
    margin: 8,
  },
  tableScrollView: {
    maxHeight: 500,
  },
  recordsInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  recordsInfoText: {
    fontSize: 12,
    color: '#666666',
  },
  loadMoreContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 8,
    backgroundColor: 'rgba(240, 240, 240, 0.5)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.1)',
  },
  loadMoreButton: {
    padding: 8,
    backgroundColor: '#0A7EA4',
    borderRadius: 4,
    flex: 1,
    marginRight: 4,
    alignItems: 'center',
  },
  loadMoreText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
  showAllButton: {
    padding: 8,
    backgroundColor: '#555',
    borderRadius: 4,
    flex: 1,
    marginLeft: 4,
    alignItems: 'center',
  },
  showAllText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
  showFewerButton: {
    padding: 10,
    backgroundColor: '#555',
    borderRadius: 4,
    marginVertical: 8,
    marginHorizontal: 16,
    alignItems: 'center',
  },
  showFewerText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
  selectedTableFilter: {
    backgroundColor: 'rgba(10, 126, 164, 0.2)',
    borderRadius: 4,
    padding: 2,
  },
  selectedTableFilterText: {
    color: '#3498db',
    fontWeight: 'bold',
  },
  clearFilterButton: {
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255, 87, 87, 0.2)',
    borderRadius: 4,
  },
  clearFilterText: {
    fontSize: 11,
    color: '#ff5757',
  },
  filterShortcutsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 8,
  },
  filterShortcutButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(240, 240, 240, 0.8)',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  activeFilterShortcut: {
    backgroundColor: 'rgba(10, 126, 164, 0.2)',
  },
  filterShortcutText: {
    fontSize: 11,
    color: '#333333',
  },
  skipCompensationContainer: {
    marginTop: 8,
    padding: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.2)',
  },
  skipCompensationTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 4,
  },
  skipCompensationExplanation: {
    fontSize: 11,
    fontStyle: 'italic',
    color: '#666666',
    marginTop: 4,
    textAlign: 'center',
  },
  iosToggleButton: {
    backgroundColor: '#FF9500', // iOS orange color
    borderRadius: 25,
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  weightItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  weightLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333333',
  },
  debugWeightsSummary: {
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  
  debugWeightsHeader: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 8,
    textAlign: 'center',
  },
  
  debugWeightsInfo: {
    fontSize: 14,
    color: '#333333',
    marginBottom: 4,
  },
  tableStatDataContainer: {
    marginTop: 2,
  },
  tableStatBarContainer: {
    height: 4,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 2,
    marginTop: 2,
    marginBottom: 2,
  },
  tableStatBar: {
    height: 4,
    borderRadius: 2,
  },
  tableStatValue: {
    fontSize: 11,
    color: '#333333',
  },
  statsDistributionCard: {
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  operationStatItem: {
    flexDirection: 'column',
    marginBottom: 8,
  },
  operationStatLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  operationStatDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 5,
  },
  operationStatLabel: {
    fontSize: 12,
    color: '#333333',
  },
  operationStatDataContainer: {
    marginTop: 2,
  },
  operationStatBarContainer: {
    height: 4,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 2,
    marginTop: 2,
    marginBottom: 2,
  },
  operationStatBar: {
    height: 4,
    borderRadius: 2,
  },
  operationStatValue: {
    fontSize: 11,
    color: '#333333',
  },
  filterControlsContainer: {
    marginBottom: 10,
  },
  filterLabelContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  filterLabel: {
    fontSize: 13,
    color: '#333333',
  },
  filterButtonsScrollView: {
    maxHeight: 40,
  },
  filterButtonsContainer: {
    flexDirection: 'row',
    paddingVertical: 4,
  },
  filterButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#F0F0F0',
    borderRadius: 16,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  filterButtonText: {
    fontSize: 12,
    color: '#333333',
  },
  recordControlButtons: {
    flexDirection: 'row',
  },
  recordControlButton: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 4,
    marginLeft: 8,
  },
  // Enhanced table styles
  enhancedTableContainer: {
    width: '100%',
    borderRadius: 8,
    overflow: 'hidden',
    marginVertical: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  enhancedTableHeader: {
    flexDirection: 'row',
    backgroundColor: '#0A7EA4', 
    padding: 8,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  enhancedHeaderCell: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
  },
  enhancedTimeCell: {
    width: '12%',
    paddingHorizontal: 2,
  },
  enhancedDirectionCell: {
    width: '12%',
    paddingHorizontal: 2,
  },
  enhancedTableCell: {
    width: '15%',
    paddingHorizontal: 2,
  },
  enhancedOperationCell: {
    width: '15%',
    paddingHorizontal: 2,
  },
  enhancedActionCell: {
    width: '15%',
    paddingHorizontal: 2,
  },
  enhancedActionText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#555',
  },
  enhancedRecordsCell: {
    width: '8%',
    paddingHorizontal: 2,
    textAlign: 'center',
  },
  enhancedStatusCell: {
    width: '10%',
    paddingHorizontal: 2,
  },
  enhancedDataCell: {
    flex: 1,
    paddingHorizontal: 2,
  },
  enhancedCell: {
    justifyContent: 'center',
    paddingVertical: 4,
  },
  enhancedTableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    padding: 6,
  },
  enhancedTableRowAlt: {
    backgroundColor: '#f9f9f9',
  },
  enhancedTableRowError: {
    backgroundColor: 'rgba(255, 90, 95, 0.1)',
  },
  enhancedTimeText: {
    fontSize: 12,
    color: '#333333',
    fontWeight: '500',
  },
  enhancedTimeSubtext: {
    fontSize: 9,
    color: '#666666',
  },
  enhancedDirectionIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 2,
  },
  enhancedSentIcon: {
    backgroundColor: '#4CAF50',
  },
  enhancedReceivedIcon: {
    backgroundColor: '#2196F3',
  },
  enhancedSentCell: {
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
  },
  enhancedReceivedCell: {
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
  },
  enhancedDirectionIconText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  enhancedDirectionText: {
    fontSize: 10,
    color: '#333333',
  },
  enhancedTableIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  enhancedTableText: {
    fontSize: 11,
    color: '#333333',
  },
  enhancedOperationText: {
    fontSize: 11,
    fontWeight: '500',
  },
  enhancedStatusIndicator: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  enhancedSuccessIndicator: {
    backgroundColor: '#4CAF50',
  },
  enhancedErrorIndicator: {
    backgroundColor: '#FF5252',
  },
  enhancedStatusText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  enhancedDataText: {
    color: '#0A7EA4',
    fontSize: 11,
    textAlign: 'center',
  },
  enhancedTableScrollView: {
    maxHeight: 400,
  },
  enhancedExpandedDataContainer: {
    padding: 10,
    backgroundColor: '#f5f5f5',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  enhancedExpandedDataHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  enhancedExpandedDataTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#333333',
  },
  enhancedExpandedDataError: {
    fontSize: 12,
    color: '#f44336',
  },
  enhancedDataScrollView: {
    maxHeight: 200,
  },
  enhancedDataJsonText: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#333333',
  },
  enhancedEmptyState: {
    padding: 20,
    alignItems: 'center',
  },
  enhancedEmptyText: {
    fontSize: 14,
    color: '#333333',
  },
  enhancedLoadMoreButton: {
    backgroundColor: '#0A7EA4',
    padding: 8,
    alignItems: 'center',
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  enhancedLoadMoreText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
}); 
