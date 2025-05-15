import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Dimensions,
  Platform,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useAppSelector } from '@/src/store/hooks';
import { FeatherIcon } from '@/components/FeatherIcon';
import * as Haptics from 'expo-haptics';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withTiming,
  withSpring,
  Easing,
  type WithTimingConfig,
  type WithSpringConfig,
} from 'react-native-reanimated';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useThemeColor } from '@/hooks/useThemeColor';
import { WebContainer } from '@/components/WebContainer';
import { fetchTriviaQuestions, FeedItem } from '../../lib/triviaService';

const { width, height } = Dimensions.get('window');

type FeatherIconName = 
  | 'check-circle' | 'award' | 'skip-forward' | 'trending-up' 
  | 'target' | 'alert-triangle' | 'chevron-up' | 'chevron-down';

// Add types for the props
interface StatCardProps {
  icon: FeatherIconName;
  title: string;
  value: number;
  subtext?: string;
  color?: string;
  animate?: boolean;
  delay?: number;
  valuePrefix?: string;
  valueSuffix?: string;
}

// Helper component for stat cards
const StatCard: React.FC<StatCardProps> = ({ 
  icon, 
  title, 
  value, 
  subtext, 
  color = '#0a7ea4',
  animate = false,
  delay = 0,
  valuePrefix = '',
  valueSuffix = ''
}) => {
  // Get theme colors
  const colorScheme = useColorScheme() ?? 'light';
  const backgroundColor = useThemeColor({}, 'background');
  const { width } = Dimensions.get('window');
  const isTablet = width > 768;
  
  // Animation for card appearance
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.8);
  
  React.useEffect(() => {
    opacity.value = withTiming(1, { 
      duration: 600,
      easing: Easing.out(Easing.quad),
      // @ts-ignore delay is not in the type but works in the API
      delay
    });
    scale.value = withSpring(1, { 
      damping: 12, 
      stiffness: 90,
      // @ts-ignore delay is not in the type but works in the API
      delay
    });
  }, []);
  
  const animatedStyle = useAnimatedStyle(() => {
    return {
      opacity: opacity.value,
      transform: [{ scale: scale.value }]
    };
  });

  return (
    <Animated.View style={[
      styles.statCard, 
      { 
        backgroundColor,
        width: Platform.OS === 'web' 
          ? isTablet ? '23%' : '48%' 
          : '48%'
      },
      animatedStyle
    ]}>
      <View style={[styles.iconContainer, { backgroundColor: `${color}20` }]}>
        <FeatherIcon name={icon} size={24} color={color} />
      </View>
      <View style={styles.statContent}>
        <ThemedText style={styles.statTitle}>{title}</ThemedText>
        <ThemedText style={[styles.statValue, { color }]}>
          {valuePrefix}{value}{valueSuffix}
        </ThemedText>
        {subtext ? <ThemedText style={styles.statSubtext}>{subtext}</ThemedText> : null}
      </View>
    </Animated.View>
  );
};

// Define the prop types for CategoryProgressCard
interface CategoryProgressCardProps {
  topic: string;
  answeredCount: number;
  totalCount: number;
  color: string;
}

// Category progress card
const CategoryProgressCard: React.FC<CategoryProgressCardProps> = ({ 
  topic, 
  answeredCount, 
  totalCount, 
  color 
}) => {
  const colorScheme = useColorScheme() ?? 'light';
  const backgroundColor = useThemeColor({}, 'background');
  
  const progressWidth = useMemo(() => {
    return (answeredCount / totalCount) * 100;
  }, [answeredCount, totalCount]);
  
  // Animation for progress bar
  const progress = useSharedValue(0);
  
  React.useEffect(() => {
    progress.value = withTiming(progressWidth, {
      duration: 1000,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    });
  }, [progressWidth]);
  
  const progressStyle = useAnimatedStyle(() => {
    return {
      width: `${progress.value}%`,
    };
  });

  return (
    <View style={[styles.categoryCard, { backgroundColor }]}>
      <View style={styles.categoryHeader}>
        <ThemedText style={styles.categoryTitle}>{topic}</ThemedText>
        <ThemedText style={styles.categoryCount}>{answeredCount}/{totalCount}</ThemedText>
      </View>
      <View style={[
        styles.progressContainer,
        { backgroundColor: colorScheme === 'dark' ? '#333' : '#f0f0f0' }
      ]}>
        <Animated.View 
          style={[
            styles.progressBar, 
            { backgroundColor: color },
            progressStyle
          ]} 
        />
      </View>
    </View>
  );
};

// Define the prop types for InsightCard
interface InsightCardProps {
  title: string;
  content: string;
  index: number;
}

// Educational insight card
const InsightCard: React.FC<InsightCardProps> = ({ 
  title, 
  content, 
  index 
}) => {
  const [expanded, setExpanded] = React.useState(false);
  const contentHeight = useSharedValue(0);
  const colorScheme = useColorScheme() ?? 'light';
  
  const toggleExpanded = () => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setExpanded(!expanded);
    contentHeight.value = withTiming(expanded ? 0 : 500, {
      duration: 300,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    });
  };
  
  const animatedContentStyle = useAnimatedStyle(() => {
    return {
      height: expanded ? 'auto' : 0,
      opacity: withTiming(expanded ? 1 : 0, { duration: 200 }),
    };
  });

  const insightBackgroundColor = expanded 
    ? colorScheme === 'dark' ? '#0a7ea420' : '#0a7ea420'
    : colorScheme === 'dark' ? '#333' : '#f0f0f0';

  return (
    <TouchableOpacity 
      activeOpacity={0.9} 
      onPress={toggleExpanded}
      style={[
        styles.insightCard, 
        { backgroundColor: insightBackgroundColor }
      ]}
    >
      <View style={styles.insightHeader}>
        <ThemedText style={styles.insightTitle}>{title}</ThemedText>
        <FeatherIcon 
          name={expanded ? "chevron-up" : "chevron-down"} 
          size={20} 
          color={colorScheme === 'dark' ? '#ccc' : '#666'} 
        />
      </View>
      {expanded && (
        <Animated.View style={[styles.insightContent, animatedContentStyle]}>
          <ThemedText style={styles.insightText}>{content}</ThemedText>
        </Animated.View>
      )}
    </TouchableOpacity>
  );
};

const StatsScreen: React.FC = () => {
  const colorScheme = useColorScheme() ?? 'dark';
  const isDark = colorScheme === 'dark';
  const backgroundColor = useThemeColor({}, 'background');
  
  const questions = useAppSelector(state => state.trivia.questions);
  const [feedData, setFeedData] = useState<FeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Force dark theme on web if not explicitly set
  useEffect(() => {
    if (Platform.OS === 'web') {
      // Add a class to the document body to ensure dark theme styles are applied
      document.body.classList.add('dark-theme');
      // Clean up when component unmounts
      return () => {
        document.body.classList.remove('dark-theme');
      };
    }
  }, []);

  useEffect(() => {
    const loadTriviaQuestions = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const questions = await fetchTriviaQuestions();
        setFeedData(questions);
      } catch (error) {
        console.error('Failed to load trivia questions for stats:', error);
        setLoadError('Failed to load questions. Stats may be incomplete.');
      } finally {
        setIsLoading(false);
      }
    };

    loadTriviaQuestions();
  }, []);
  
  const stats = useMemo(() => {
    const totalQuestions = feedData.length;
    let answered = 0;
    let correct = 0;
    let skipped = 0;
    let categoryStats: Record<string, { total: number; correct: number; answered: number }> = {};
    let difficultyStats: Record<string, { total: number; correct: number; answered: number }> = {
      'Easy': { total: 0, correct: 0, answered: 0 },
      'Medium': { total: 0, correct: 0, answered: 0 },
      'Hard': { total: 0, correct: 0, answered: 0 },
    };

    feedData.forEach(item => {
      if (!categoryStats[item.topic]) {
        categoryStats[item.topic] = { total: 0, correct: 0, answered: 0 };
      }
      categoryStats[item.topic].total++;
      if (difficultyStats[item.difficulty]) {
        difficultyStats[item.difficulty].total++;
      }
    });

    Object.entries(questions).forEach(([questionId, questionState]) => {
      const question = feedData.find(q => q.id === questionId);
      
      if (!question) return;
      
      if (questionState.status === 'answered') {
        answered++;
        categoryStats[question.topic].answered++;
        if (difficultyStats[question.difficulty]) {
          difficultyStats[question.difficulty].answered++;
        
          if (questionState.answerIndex !== undefined && 
              question.answers[questionState.answerIndex].isCorrect) {
            correct++;
            categoryStats[question.topic].correct++;
            difficultyStats[question.difficulty].correct++;
          }
        }
      } else if (questionState.status === 'skipped') {
        skipped++;
      }
    });

    const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0;
    
    const completion = totalQuestions > 0 ? Math.round((answered / totalQuestions) * 100) : 0;
    
    const categories = Object.entries(categoryStats).map(([name, stats]) => ({
      name,
      ...stats,
      percentage: stats.total > 0 ? Math.round((stats.answered / stats.total) * 100) : 0,
    })).sort((a, b) => b.percentage - a.percentage);

    const difficultyBreakdown = Object.entries(difficultyStats).map(([difficulty, stats]) => ({
      difficulty,
      ...stats,
      accuracy: stats.answered > 0 ? Math.round((stats.correct / stats.answered) * 100) : 0
    }));

    return {
      totalQuestions,
      answered,
      correct,
      skipped,
      accuracy,
      completion,
      categories,
      difficultyBreakdown
    };
  }, [questions, feedData]);

  const educationalInsights = [
    {
      title: 'Spaced Repetition Matters',
      content: 'Research shows that reviewing information at increasing intervals over time improves long-term retention by up to 200% compared to cramming. Try revisiting questions you\'ve answered incorrectly after a few days.'
    },
    {
      title: 'The Testing Effect',
      content: 'Taking quizzes actually helps you learn better than passive reading. When you retrieve information from memory during a quiz, you strengthen neural pathways associated with that knowledge, making it easier to recall in the future.'
    },
    {
      title: 'Contextual Learning',
      content: 'The "Did You Know" facts in this app use contextual learning - connecting new information to existing knowledge helps form stronger memory associations and improves comprehension by up to 40%.'
    },
    {
      title: 'Mistake-Driven Learning',
      content: 'Getting questions wrong is actually valuable! Studies show that learning from mistakes leads to better understanding and retention than simply memorizing correct answers. Review your mistakes carefully for maximum benefit.'
    }
  ];

  const mostImprovedCategory = useMemo(() => {
    if (stats.categories.length === 0) return null;
    return stats.categories[0];
  }, [stats.categories]);

  const areasToFocus = useMemo(() => {
    return stats.categories
      .filter(cat => cat.answered > 0)
      .sort((a, b) => a.percentage - b.percentage)
      .slice(0, 2);
  }, [stats.categories]);
  
  const categoryColors: Record<string, string> = {
    'Science': '#00B8D4',         // Cyan
    'Technology': '#304FFE',      // Indigo
    'History': '#D500F9',         // Purple
    'Geography': '#00C853',       // Green
    'Sports': '#FF6D00',          // Orange
    'Movies': '#FF1744',          // Red-Pink
    'Music': '#6200EA',           // Deep Purple
    'Television': '#0091EA',      // Light Blue
    'Literature': '#D50000',      // Red
    'Art': '#F50057',             // Pink
    'Pop Culture': '#FFD600',     // Yellow
    'Food & Drink': '#FF3D00',    // Deep Orange
    'General Knowledge': '#00BFA5', // Teal
    'Nature': '#64DD17',          // Light Green
    'Politics': '#651FFF',        // Deep Purple
    'Celebrities': '#FFC400',     // Amber
    'Modern Cinema': '#C51162',   // Pink
    'Mathematics': '#00BFA5',     // Teal
    'Language': '#2962FF',        // Blue
    'Mythology': '#AA00FF',       // Purple
    'Animals': '#76FF03',         // Light Green
  };

  if (isLoading) {
    return (
      <ThemedView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#0a7ea4" />
        <ThemedText style={styles.loadingText}>Loading stats...</ThemedText>
      </ThemedView>
    );
  }

  const Content = (
    <ThemedView style={styles.container}>
      {loadError && (
        <View style={styles.errorBanner}>
          <FeatherIcon name="alert-triangle" size={16} color="#e74c3c" />
          <ThemedText style={styles.errorText}>{loadError}</ThemedText>
        </View>
      )}
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <ThemedText type="title" style={styles.title}>Your Stats</ThemedText>
        
        <View style={styles.statsGrid}>
          <StatCard 
            icon="check-circle" 
            title="Questions Answered" 
            value={stats.answered} 
            subtext={`${stats.completion}% completion`}
            color="#4CAF50"
            animate
            delay={100}
          />
          <StatCard 
            icon="award" 
            title="Accuracy Rate" 
            value={stats.accuracy} 
            valueSuffix="%"
            subtext={`${stats.correct} correct answers`}
            color="#FFC107"
            animate
            delay={200}
          />
          <StatCard 
            icon="skip-forward" 
            title="Questions Skipped" 
            value={stats.skipped}
            subtext=""
            color="#607D8B"
            animate
            delay={300}
          />
          <StatCard 
            icon="trending-up" 
            title="Questions Remaining" 
            value={stats.totalQuestions - stats.answered}
            subtext=""
            color="#9C27B0" 
            animate
            delay={400}
          />
        </View>

        <ThemedView style={styles.sectionContainer}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Performance by Difficulty
          </ThemedText>
          
          {stats.difficultyBreakdown.map((item, index) => (
            <View key={item.difficulty} style={[styles.difficultyItem, { backgroundColor }]}>
              <View style={styles.difficultyHeader}>
                <View style={[styles.difficultyBadge, { 
                  backgroundColor: 
                    item.difficulty === 'Easy' ? '#4CAF5050' :
                    item.difficulty === 'Medium' ? '#FFC10750' :
                    '#F4433650'
                }]}>
                  <ThemedText style={[styles.difficultyText, {
                    color:
                      item.difficulty === 'Easy' ? '#4CAF50' :
                      item.difficulty === 'Medium' ? '#FFC107' :
                      '#F44336'  
                  }]}>{item.difficulty}</ThemedText>
                </View>
                <ThemedText style={styles.accuracyText}>
                  {item.answered > 0 ? `${item.accuracy}% accuracy` : 'Not started'}
                </ThemedText>
              </View>
              
              <View style={styles.difficultyStats}>
                <ThemedText style={styles.statDetail}>
                  <ThemedText type="defaultSemiBold">Answered:</ThemedText> {item.answered}/{item.total}
                </ThemedText>
                <ThemedText style={styles.statDetail}>
                  <ThemedText type="defaultSemiBold">Correct:</ThemedText> {item.correct}/{item.answered}
                </ThemedText>
              </View>
            </View>
          ))}
        </ThemedView>
        
        <ThemedView style={styles.sectionContainer}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Category Progress
          </ThemedText>
          
          {stats.categories.map((category, index) => (
            <CategoryProgressCard
              key={category.name}
              topic={category.name}
              answeredCount={category.answered}
              totalCount={category.total}
              color={categoryColors[category.name] || '#0a7ea4'}
            />
          ))}
        </ThemedView>
        
        <ThemedView style={styles.sectionContainer}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Learning Insights
          </ThemedText>
          
          {educationalInsights.map((insight, index) => (
            <InsightCard 
              key={index}
              title={insight.title}
              content={insight.content}
              index={index}
            />
          ))}
        </ThemedView>
        
        <ThemedView style={styles.sectionContainer}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Personalized Recommendations
          </ThemedText>
          
          {areasToFocus.length > 0 ? (
            <View style={[styles.recommendationsContainer, { backgroundColor }]}>
              <ThemedText style={styles.recommendationTitle}>
                Focus areas:
              </ThemedText>
              {areasToFocus.map((category, index) => (
                <View key={index} style={styles.focusArea}>
                  <FeatherIcon name="target" size={18} color="#0a7ea4" style={styles.focusIcon} />
                  <ThemedText style={styles.focusText}>
                    {category.name} ({category.percentage}% complete)
                  </ThemedText>
                </View>
              ))}
              
              {mostImprovedCategory && (
                <View style={styles.improvedContainer}>
                  <ThemedText style={styles.recommendationTitle}>
                    Most progress in:
                  </ThemedText>
                  <View style={styles.focusArea}>
                    <FeatherIcon name="trending-up" size={18} color="#4CAF50" style={styles.focusIcon} />
                    <ThemedText style={styles.mostImprovedText}>
                      {mostImprovedCategory.name} ({mostImprovedCategory.percentage}% complete)
                    </ThemedText>
                  </View>
                </View>
              )}
              
              <View style={[
                styles.tipContainer, 
                { backgroundColor: colorScheme === 'dark' ? '#1E3A4D' : '#E3F2FD' }
              ]}>
                <ThemedText style={styles.tipText}>
                  <ThemedText type="defaultSemiBold">Learning tip:</ThemedText> Questions you get wrong are 
                  actually the most valuable! Research shows reviewing your mistakes helps 
                  build stronger neural connections.
                </ThemedText>
              </View>
            </View>
          ) : (
            <ThemedText style={styles.emptyStateText}>
              Start answering questions to get personalized recommendations!
            </ThemedText>
          )}
        </ThemedView>
      </ScrollView>
    </ThemedView>
  );

  if (Platform.OS === 'web') {
    return (
      <WebContainer>
        {Content}
      </WebContainer>
    );
  }

  return Content;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 60,
    paddingHorizontal: Platform.OS === 'web' ? 24 : 16,
    maxWidth: Platform.OS === 'web' ? 1200 : undefined,
    alignSelf: Platform.OS === 'web' ? 'center' : undefined,
    width: Platform.OS === 'web' ? '100%' : undefined,
  },
  title: {
    marginBottom: 16,
    paddingHorizontal: 8,
    textAlign: Platform.OS === 'web' ? 'center' : 'left',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  statCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(150, 150, 150, 0.2)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
      web: {
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      },
    }),
  },
  iconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  statContent: {
    flex: 1,
  },
  statTitle: {
    fontSize: 12,
    opacity: 0.7,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  statSubtext: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 2,
  },
  sectionContainer: {
    marginBottom: 24,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(150, 150, 150, 0.2)',
  },
  sectionTitle: {
    marginBottom: 12,
    paddingHorizontal: 8,
    textAlign: Platform.OS === 'web' ? 'center' : 'left',
  },
  progressContainer: {
    height: 8,
    borderRadius: 4,
    marginTop: 4,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 4,
  },
  categoryCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(150, 150, 150, 0.2)',
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  categoryCount: {
    fontSize: 14,
    opacity: 0.7,
  },
  difficultyItem: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(150, 150, 150, 0.2)',
  },
  difficultyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  difficultyBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  difficultyText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  accuracyText: {
    fontSize: 14,
  },
  difficultyStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statDetail: {
    fontSize: 14,
  },
  recommendationsContainer: {
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(150, 150, 150, 0.2)',
  },
  recommendationTitle: {
    fontSize: 16,
    marginBottom: 8,
  },
  focusArea: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingLeft: 4,
  },
  focusIcon: {
    marginRight: 8,
  },
  focusText: {
    fontSize: 15,
  },
  improvedContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(150, 150, 150, 0.2)',
  },
  mostImprovedText: {
    fontSize: 15,
    color: '#4CAF50',
  },
  tipContainer: {
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(150, 150, 150, 0.2)',
  },
  tipText: {
    fontSize: 14,
    lineHeight: 20,
  },
  emptyStateText: {
    textAlign: 'center',
    padding: 20,
    opacity: 0.7,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    opacity: 0.7,
  },
  errorBanner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(231, 76, 60, 0.1)',
    padding: 8,
    borderRadius: 8,
    marginHorizontal: 16,
    marginVertical: 8,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 12,
    color: '#e74c3c',
    marginLeft: 8,
    flex: 1,
  },
  insightCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(150, 150, 150, 0.2)',
  },
  insightHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  insightTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  insightContent: {
    marginTop: 12,
    overflow: 'hidden',
  },
  insightText: {
    lineHeight: 22,
  },
});

export default StatsScreen;