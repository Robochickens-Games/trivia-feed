import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  Dimensions,
  ViewToken,
  Animated,
  Easing,
  TouchableOpacity,
  Platform,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Modal as RNModal,
  SafeAreaView,
  ScrollView,
  Image,
  TextInput,
  Alert,
  ActivityIndicator,
  GestureResponderEvent,
} from 'react-native';
import { 
  Text, 
  IconButton,
  Surface, 
  Portal, 
  Modal, 
  Button as PaperButton 
} from 'react-native-paper';
import { Card } from '../../components/ui/Card';
import FeedItem from './FeedItem';
// Remove mock data import
// import { mockFeedData } from '../../data/mockData';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { 
  markTooltipAsViewed, 
  permanentlyDismissTooltip,
  skipQuestion, 
  startInteraction,
  setPersonalizedFeed,
  updateUserProfile as updateUserProfileAction,
  answerQuestion,
  QuestionState
} from '../../store/triviaSlice';
import { useIOSAnimations } from '@/hooks/useIOSAnimations';
// Fix the import path
import { fetchTriviaQuestions, FeedItem as FeedItemType, analyzeCorrectAnswers } from '../../lib/triviaService';
import { useThemeColor } from '@/hooks/useThemeColor';
import { 
  updateUserProfile, 
  getPersonalizedFeed,
  UserProfile,
} from '../../lib/personalizationService';
import { InteractionTracker } from '../../components/InteractionTracker';
import { useAuth } from '../../context/AuthContext';
import { colors as themeColors, spacing, borderRadius, zIndex } from '../../design';
import { syncWeightChanges } from '../../lib/syncService';
import { loadUserDataThunk } from '../../store/thunks';
import { FeatherIcon } from '@/components/FeatherIcon';
import { ThemedText } from '@/components/ThemedText';
import { useColorScheme } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { supabase } from '../../lib/supabaseClient';
import { countries } from '../../data/countries';
import ProfileBottomSheet from '../../components/ProfileBottomSheet';
import LeaderboardBottomSheet from '../../components/LeaderboardBottomSheet';
import { runQuestionGeneration } from '../../lib/questionGeneratorService';
import { useQuestionGenerator } from '../../hooks/useQuestionGenerator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LoadingBar } from '../../components/ui';
import { useTheme } from '@/src/context/ThemeContext';
import { NeonColors } from '@/constants/NeonColors';
import ThemedLoadingScreen from '@/src/components/ThemedLoadingScreen';
import { useAppLoading } from '@/app/_layout';
import { Colors } from '@/constants/Colors';
import { QuestionInteraction } from '../../lib/personalizationService';

const { width, height } = Dimensions.get('window');

// Move StyleSheet outside of component
const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    width: '100%', // Ensure full width
    height: '100%', // Ensure full height
  },
  flatList: {
    width: '100%', // Full width for web and mobile
    height: '100%', // Full height
    flex: 1,
  },
  flatListContent: {
    // No additional padding or spacing that would cause items to overflow
    flexGrow: 1,
  },
  itemContainer: {
    width: '100%',
    // Height is dynamically set in renderItem using viewportHeight
    // This ensures each item takes exactly one screen
  },
  tooltipWrapper: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: zIndex.tooltip - 10, // Make sure it's below bottomsheets
    width: '100%',
  },
  tooltip: {
    width: 220,
    alignItems: 'center',
    borderRadius: borderRadius.xl,
    padding: spacing[4],
    borderWidth: 1,
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 3px 10px rgba(0, 0, 0, 0.35)',
    } : {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.2,
      shadowRadius: 5,
      elevation: 6,
    }),
  },
  tooltipArrow: {
    position: 'absolute',
    bottom: -8,
    left: '50%',
    marginLeft: -8, // Half of the arrow width
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  tooltipText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing[2],
    fontWeight: '500',
  },
  tiktokAnimationContainer: {
    height: 85,
    width: 100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
  },
  phoneFrame: {
    width: 45,
    height: 80,
    borderRadius: borderRadius.xl,
    borderWidth: 2,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  phoneContent: {
    width: '100%',
    height: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  mockScreen: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: borderRadius.sm,
  },
  mockScreen1: {
    backgroundColor: 'rgba(255, 100, 100, 0.6)',
  },
  mockScreen2: {
    backgroundColor: 'rgba(100, 100, 255, 0.6)',
  },
  finger: {
    position: 'absolute',
    right: -10,
    width: 20,
    height: 30,
    alignItems: 'center',
    zIndex: 3,
  },
  fingerElement: {
    width: 15,
    height: 22,
    borderRadius: 12,
    backgroundColor: 'white',
    transform: [{ rotate: '-20deg' }],
  },
  fingerTip: {
    position: 'absolute',
    bottom: -2,
    right: 3,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'white',
  },
  fingerShadow: {
    position: 'absolute',
    top: 2,
    width: 18,
    height: 25,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    zIndex: -1,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 20,
  },
  errorText: {
    color: '#ff3b30', // Use hardcoded color value for error
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 10,
    backgroundColor: '#007aff', // Use hardcoded color for primary
  },
  explanationModal: {
    margin: spacing[5],
  },
  explanationText: {
    marginBottom: spacing[2],
    fontSize: 14,
  },
  mockDataBanner: {
    position: 'absolute',
    top: spacing[5],
    left: spacing[5],
    right: spacing[5],
    backgroundColor: 'rgba(244, 67, 54, 0.9)',
    padding: spacing[3],
    borderRadius: borderRadius.md,
    zIndex: 100,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  mockDataText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: 'bold',
  },
  // Update profile button styles
  profileButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 25,
    left: 20,
    width: 50,
    height: 50,
    borderRadius: 25,
    zIndex: 10,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  avatarCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#ffc107',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  avatarText: {
    color: 'black',
    fontSize: 18,
    fontWeight: 'bold',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  loadingIcon: {
    width: 120,
    height: 120,
    marginBottom: 20,
  },
  loadingIndicatorContainer: {
    marginBottom: 30,
  },
  loadingTip: {
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: 30,
    color: '#007aff', // Use hardcoded color for secondary
    maxWidth: 320,
    fontStyle: 'italic',
  },
  // Add debug button styles
  debugButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 25,
    right: 20,
    width: 60,
    height: 30,
    borderRadius: 15,
    zIndex: 100, // Increase zIndex to ensure it's above all content
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  debugButtonInner: {
    width: 60,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#ff5722',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  debugButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  debugToast: {
    position: 'absolute',
    top: '40%',
    left: '10%',
    right: '10%',
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 10,
    padding: 16,
    zIndex: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  debugToastText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  neonRetryButton: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    backgroundColor: 'rgba(10, 10, 20, 0.9)', // Very dark blue-black with transparency
    borderWidth: 2.5, // Thicker border for more intense effect
    borderColor: NeonColors.dark.primary,
    shadowColor: NeonColors.dark.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9, // Higher opacity for stronger glow
    shadowRadius: 12, // Larger radius for more dramatic effect
    elevation: Platform.OS === 'android' ? 10 : 0,
    ...(Platform.OS === 'web' ? {
      boxShadow: `0 0 15px ${NeonColors.dark.primary}, 0 0 8px ${NeonColors.dark.primary}`,
    } as any : {}),
  },
  neonRetryButtonIOS: {
    // iOS-specific shadow properties for better performance
    shadowColor: NeonColors.dark.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 8,
  },
  neonRetryText: {
    color: NeonColors.dark.primary,
    fontSize: 20, // Larger text
    fontWeight: 'bold',
    textShadowColor: NeonColors.dark.primary,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8, // More intense text glow
  },
  retryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  tooltipButton: {
    marginTop: spacing[2],
  },
  tooltipButtonLabel: {
    fontWeight: '600',
  },
});

const FeedScreen: React.FC = () => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showTooltip, setShowTooltip] = useState(false);
  const [isAnimationError, setIsAnimationError] = useState(false);
  // Add state for feed data
  const [feedData, setFeedData] = useState<FeedItemType[]>([]);
  const [isLocalLoading, setIsLocalLoading] = useState(true); // Renamed to avoid confusion
  const [loadError, setLoadError] = useState<string | null>(null);
  const [usingMockData, setUsingMockData] = useState(false);
  // Add state for selection explanations 
  const [showExplanationModal, setShowExplanationModal] = useState(false);
  const [currentExplanation, setCurrentExplanation] = useState<string[]>([]);
  // Add state for profile modal
  const [showProfile, setShowProfile] = useState(false);
  // Add a state variable for the leaderboard visibility
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [currentLeaderboardItemId, setCurrentLeaderboardItemId] = useState<string | null>(null);
  
  // Add state for debug panel visibility
  const [debugPanelVisible, setDebugPanelVisible] = useState(false);
  
  // Get user from auth context
  const { user, isGuest } = useAuth();
  
  // Add a new state for the avatar URL
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  
  const flatListRef = useRef<FlatList>(null);
  const lastInteractionTime = useRef(Date.now());
  const lastVisibleItemId = useRef<string | null>(null);
  const previousIndex = useRef<number>(0);
  // Add ref to track previous userProfile for cold start updates
  const previousUserProfileRef = useRef<typeof userProfile | null>(null);
  // Add this near the top of the component with other refs
  const lastVisibleIndexRef = useRef<number | null>(null);

  // Get all theme colors at the top level
  const backgroundColor = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const borderColor = useThemeColor({}, 'border');
  const primaryColor = useThemeColor({}, 'primary');

  // State to track viewport height on web for proper sizing
  const [viewportHeight, setViewportHeight] = useState(
    Platform.OS === 'web' ? window.innerHeight : height
  );

  // Use our custom iOS animations hook
  const { opacity, scale, animateIn, animateOut, resetAnimations } = useIOSAnimations();

  const dispatch = useAppDispatch();
  const hasViewedTooltip = useAppSelector(state => state.trivia.hasViewedTooltip);
  const tooltipPermanentlyDismissed = useAppSelector(state => state.trivia.tooltipPermanentlyDismissed);
  const questions = useAppSelector(state => state.trivia.questions);
  const userProfile = useAppSelector(state => state.trivia.userProfile);
  const personalizedFeed = useAppSelector(state => state.trivia.personalizedFeed);
  const feedExplanations = useAppSelector(state => state.trivia.feedExplanations);
  const interactionStartTimes = useAppSelector(state => state.trivia.interactionStartTimes);
  const isSyncing = useAppSelector(state => state.trivia.isSyncing);
  const lastSyncTime = useAppSelector(state => state.trivia.lastSyncTime);

  // Add state to track scroll activity
  const [isActivelyScrolling, setIsActivelyScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastScrollPosition = useRef<number>(0);
  
  // Add state for profile username at component level
  const [profileUsername, setProfileUsername] = useState<string | null>(null);

  // Get app loading context
  const { isAppLoading, setIsAppLoading } = useAppLoading();

  // Add state to track last question answered time
  const [lastAnswerTime, setLastAnswerTime] = useState<number | null>(null);
  const [shouldShowTooltip, setShouldShowTooltip] = useState(false);
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch username from the database when user changes
  useEffect(() => {
    const fetchUsername = async () => {
      if (user?.id) {
        try {
          const { data } = await supabase
            .from('user_profiles')
            .select('full_name')
            .eq('id', user?.id)
            .single();
          
          if (data?.full_name) {
            setProfileUsername(data.full_name);
          }
        } catch (error) {
          console.error('Error fetching user profile:', error);
        }
      }
    };
    
    fetchUsername();
  }, [user?.id]);

  // Add debugging for loading state
  useEffect(() => {
    console.log('FeedScreen - AppLoading state:', isAppLoading);
    
    // Clean up loading state when component unmounts
    return () => {
      if (isAppLoading) {
        console.log('FeedScreen unmounting while still loading, cleaning up loading state');
        setIsAppLoading(false);
      }
    };
  }, [isAppLoading]);

  // Get user initials for the profile button
  const getInitials = () => {
    // Use the fetched full_name if available
    if (profileUsername) {
      return profileUsername.substring(0, 2).toUpperCase();
    }
    
    // Fallback to email if available
    if (user?.email) {
      return user.email.substring(0, 2).toUpperCase();
    }
    
    // Ultimate fallback
    return 'ZT';
  };
  
  // Load user data when component mounts if user is logged in
  useEffect(() => {
    if (user?.id) {
      console.log('User is logged in, loading user data');
      
      // Dispatch the thunk to load all user data
      dispatch(loadUserDataThunk(user?.id))
        .then((userData) => {
          console.log('User data loaded successfully');
          
          // After loading data, if we have a personalized feed, we may want to
          // rebuild it with the latest user profile data
          if (userData.profile && personalizedFeed.length === 0 && feedData.length > 0) {
            console.log('Generating personalized feed with loaded user profile');
            const { items, explanations } = getPersonalizedFeed(feedData, userData.profile);
            
            // Store the feed items in a stable order
            dispatch(setPersonalizedFeed({ 
              items, 
              explanations,
              userId: user?.id
            }));
          }
        })
        .catch(error => {
          console.error('Failed to load user data:', error);
        });
    }
  }, [user?.id, dispatch, personalizedFeed.length, feedData]); // Include all dependencies

  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Fetch trivia questions from Supabase and apply personalization
  useEffect(() => {
    console.log('Starting to load trivia questions');
    
    const loadTriviaQuestions = async () => {
      setIsLocalLoading(true);
      setLoadError(null);
      
      try {
        console.log('Fetching trivia questions...');
        
        // Check cache first
        const cachedData = await AsyncStorage.getItem('cachedTriviaQuestions');
        let allQuestions = [];
        
        if (cachedData) {
          // Use cached data while fetching fresh data
          console.log('Using cached trivia questions');
          try {
            allQuestions = JSON.parse(cachedData);
            setFeedData(allQuestions);
            
            // Apply personalization with cached data
            if (allQuestions.length > 0) {
              const { items, explanations } = getPersonalizedFeed(allQuestions, userProfile);
              const uniqueItems = items.filter((item, index, self) => 
                index === self.findIndex(t => t.id === item.id)
              );
              
              const uniqueExplanations: Record<string, string[]> = {};
              uniqueItems.forEach(item => {
                if (explanations[item.id]) {
                  uniqueExplanations[item.id] = explanations[item.id];
                }
              });
              
              dispatch(setPersonalizedFeed({ 
                items: uniqueItems, 
                explanations: uniqueExplanations 
              }));
            }
          } catch (cacheError) {
            console.error('Error parsing cached data:', cacheError);
            // Continue with empty questions, will load fresh data
          }
        }
        
        // Fetch fresh data
        console.log('Fetching fresh trivia questions...');
        const freshQuestions = await fetchTriviaQuestions();
        console.log('Fresh questions loaded:', freshQuestions.length);
        
        // Check if we got mock data due to a connection error
        if (freshQuestions.length === 3 && freshQuestions[0].id === '1' && freshQuestions[0].question.includes('closest star to Earth')) {
          console.log('Using mock data due to connection error');
          setUsingMockData(true);
        } else {
          // Cache the fresh data
          await AsyncStorage.setItem('cachedTriviaQuestions', JSON.stringify(freshQuestions));
        }
        
        // Filter out duplicates by ID
        const uniqueQuestions = freshQuestions.filter((item, index, self) => 
          index === self.findIndex(t => t.id === item.id)
        );
        
        console.log(`Loaded ${freshQuestions.length} questions, ${uniqueQuestions.length} unique questions after filtering duplicates`);
        setFeedData(uniqueQuestions); // Store unique questions
        
        // Apply personalization if we have questions
        if (uniqueQuestions.length > 0) {
          const { items, explanations } = getPersonalizedFeed(uniqueQuestions, userProfile);
          
          // Ensure items are unique again (personalization might introduce duplicates)
          const uniqueItems = items.filter((item, index, self) => 
            index === self.findIndex(t => t.id === item.id)
          );
          
          // Create explanations object with only unique items
          const uniqueExplanations: Record<string, string[]> = {};
          uniqueItems.forEach(item => {
            if (explanations[item.id]) {
              uniqueExplanations[item.id] = explanations[item.id];
            }
          });
          
          // Store the feed items in a stable order
          dispatch(setPersonalizedFeed({ 
            items: uniqueItems, 
            explanations: uniqueExplanations 
          }));
        }
        
        console.log('Data loading complete, setting loading state to false');
      } catch (error) {
        console.error('Failed to load trivia questions:', error);
        setLoadError('Failed to load questions. Please try again later.');
      } finally {
        // Ensure we always update loading states
        setIsLocalLoading(false);
        // Signal to the app that we're done loading
        console.log('Finalizing loading process, setting app loading to false');
        // Use setTimeout to ensure this runs after render cycle
        setTimeout(() => {
          setIsAppLoading(false);
        }, 0);
      }
    };

    // Start loading data
    loadTriviaQuestions();
  }, []); // Only run on mount

  // Update effect to prevent reordering of feed after initial load
  useEffect(() => {
    // Only refresh personalized feed when userProfile changes and we don't have a feed yet
    if (feedData.length > 0 && personalizedFeed.length === 0) {
      const { items, explanations } = getPersonalizedFeed(feedData, userProfile);
      
      // Filter out any duplicate questions by ID
      const uniqueItems = items.filter((item, index, self) => 
        index === self.findIndex(t => t.id === item.id)
      );
      
      // Generate new explanations object with only unique items
      const uniqueExplanations: Record<string, string[]> = {};
      uniqueItems.forEach(item => {
        if (explanations[item.id]) {
          uniqueExplanations[item.id] = explanations[item.id];
        }
      });
      
      dispatch(setPersonalizedFeed({ 
        items: uniqueItems, 
        explanations: uniqueExplanations 
      }));
      console.log('Initial personalized feed with', uniqueItems.length, 'unique items');
    }
  }, [userProfile, feedData, personalizedFeed.length, dispatch]);

  // Add effect to refresh feed during cold start phase when userProfile changes
  useEffect(() => {
    // Skip if userProfile hasn't changed since last check
    const prevProfile = previousUserProfileRef.current;
    if (prevProfile && 
        prevProfile.totalQuestionsAnswered === userProfile?.totalQuestionsAnswered && 
        prevProfile.coldStartComplete === userProfile?.coldStartComplete) {
      return; // Profile hasn't changed in a way that affects feed ordering
    }
    
    // Only apply this logic during initial loading, not after answering questions
    const totalQuestionsAnswered = userProfile?.totalQuestionsAnswered || 0;
    const inColdStart = !userProfile?.coldStartComplete && totalQuestionsAnswered < 20;
    
    // Only use this effect for initial feed generation
    // Skip if we already have a feed and have answered questions
    if (inColdStart && feedData.length > 0 && personalizedFeed.length === 0) {
      console.log('Initial feed creation during cold start phase');
      const { items, explanations } = getPersonalizedFeed(feedData, userProfile);
      
      // Filter out any duplicate questions by ID
      const uniqueItems = items.filter((item, index, self) => 
        index === self.findIndex(t => t.id === item.id)
      );
      
      // Generate new explanations object with only unique items
      const uniqueExplanations: Record<string, string[]> = {};
      uniqueItems.forEach(item => {
        if (explanations[item.id]) {
          uniqueExplanations[item.id] = explanations[item.id];
        }
      });
      
      dispatch(setPersonalizedFeed({ 
        items: uniqueItems, 
        explanations: uniqueExplanations 
      }));
      console.log('Initial personalized feed with', uniqueItems.length, 'unique items');
    }
    
    // Update ref with current userProfile
    previousUserProfileRef.current = userProfile;
  }, [userProfile, feedData, dispatch, personalizedFeed.length]); // Added personalizedFeed.length to dependencies

  const fingerPosition = useRef(new Animated.Value(0)).current;
  const phoneFrame = useRef(new Animated.Value(0)).current;
  const mockContent1 = useRef(new Animated.Value(0)).current;
  const mockContent2 = useRef(new Animated.Value(100)).current;

  // For web, listen to window resize events to update the viewport height
  useEffect(() => {
    const calculateViewportHeight = () => {
      if (Platform.OS === 'web') {
        // For web, use the full viewport height since we don't have a navbar anymore
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        console.log(`Web viewport height: ${viewportHeight}px`);
        setViewportHeight(viewportHeight);
      } else {
        // For mobile, get the full screen dimensions without navbar deduction
        const windowHeight = Dimensions.get('window').height;
        console.log(`Mobile viewport height: ${windowHeight}px`);
        setViewportHeight(windowHeight);
      }
    };
    
    // Initial calculation
    calculateViewportHeight();
    
    if (Platform.OS === 'web') {
      // Listen for resize on web and visualViewport changes
      window.addEventListener('resize', calculateViewportHeight);
      
      // Listen for visualViewport changes if available (for mobile browsers)
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', calculateViewportHeight);
        window.visualViewport.addEventListener('scroll', calculateViewportHeight);
      }
      
      return () => {
        window.removeEventListener('resize', calculateViewportHeight);
        if (window.visualViewport) {
          window.visualViewport.removeEventListener('resize', calculateViewportHeight);
          window.visualViewport.removeEventListener('scroll', calculateViewportHeight);
        }
      };
    } else {
      // For mobile, update on dimension changes
      const dimensionsSubscription = Dimensions.addEventListener('change', () => {
        calculateViewportHeight();
      });
      
      return () => {
        dimensionsSubscription.remove();
      };
    }
  }, []);

  const createTikTokAnimation = () => {
    try {
      // Create the animation sequence
      const sequence = Animated.sequence([
        Animated.parallel([
          Animated.timing(mockContent1, {
            toValue: 0,
            duration: 100,
            useNativeDriver: true,
          }),
          Animated.timing(mockContent2, {
            toValue: 100,
            duration: 100,
            useNativeDriver: true,
          }),
          Animated.timing(fingerPosition, {
            toValue: 0,
            duration: 100,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(fingerPosition, {
          toValue: -5,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(100),
        Animated.parallel([
          Animated.timing(fingerPosition, {
            toValue: -35,
            duration: 600,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(mockContent1, {
            toValue: -80,
            duration: 600,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(mockContent2, {
            toValue: 0,
            duration: 600,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
        Animated.delay(350),
        Animated.timing(fingerPosition, {
          toValue: 40,
          duration: 400,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(600),
      ]);
      
      // Return the looped animation
      return Animated.loop(sequence);
    } catch (error) {
      console.error('Error creating animation:', error);
      setIsAnimationError(true);
      return null;
    }
  };

  const tikTokAnimation = useRef<Animated.CompositeAnimation | null>(null);

  // Update useEffect for tooltip display logic
  useEffect(() => {
    // Initial tooltip show logic - first time user only
    if (!hasViewedTooltip && !showTooltip && !shouldShowTooltip) {
      // Set up timer to show tooltip after 1.5 seconds of inactivity
      const timer = setTimeout(() => {
        setShouldShowTooltip(true);
      }, 1500);

      return () => {
        // Clean up timer
        clearTimeout(timer);
      };
    }
  }, [hasViewedTooltip, showTooltip, shouldShowTooltip]);

  // Effect to actually show the tooltip when shouldShowTooltip becomes true
  useEffect(() => {
    if (shouldShowTooltip && !showTooltip) {
      setShowTooltip(true);
      
      // Start the TikTok-style animation
      try {
        tikTokAnimation.current = createTikTokAnimation();
        if (tikTokAnimation.current) {
          tikTokAnimation.current.start();
        }
      } catch (error) {
        console.error('Error starting animation:', error);
        setIsAnimationError(true);
      }
      
      // Add spring animation for the tooltip
      animateIn();
    }
  }, [shouldShowTooltip, showTooltip]);

  // Add effect to handle post-answer tooltip display
  useEffect(() => {
    // Clear any existing timeout
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }

    // Only show tooltip if user has already seen it once, they've answered a question,
    // they haven't scrolled in the last 15 seconds, AND they haven't permanently dismissed it
    if (lastAnswerTime && hasViewedTooltip && !isActivelyScrolling && !showTooltip && !tooltipPermanentlyDismissed) {
      tooltipTimeoutRef.current = setTimeout(() => {
        setShouldShowTooltip(true);
      }, 15000); // 15 seconds
    }

    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
    };
  }, [lastAnswerTime, isActivelyScrolling, hasViewedTooltip, showTooltip, tooltipPermanentlyDismissed]);

  // Add a ref to track skip count
  const skipCountRef = useRef<number>(0);

  const allowedTopics = [
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

  // Simple function to check if we should add questions at current position
  const shouldAddQuestionsAtPosition = useCallback((position: number) => {
    // Add questions at positions 4, 8, 12, 16, 20 (after every 4 questions in cold start)
    const isCheckpoint = position % 4 === 0 && position <= 20 && position > 0;
    console.log(`[Feed] Checking position ${position} for checkpoint: ${isCheckpoint ? 'YES' : 'NO'}`);
    return isCheckpoint;
  }, []);

  // Helper function to add questions at checkpoints
  const addQuestionsAtCheckpoint = useCallback((checkpointPosition: number, updatedProfile: UserProfile) => {
    if (feedData.length > personalizedFeed.length) {
      console.log(`[Feed] Adding questions at checkpoint position ${checkpointPosition}`);
      console.log(`[Feed] Current user profile state:`, JSON.stringify(updatedProfile.topics, null, 2));
      
      // Create a set of IDs that are already in our feed
      const currentFeed = [...personalizedFeed];
      const existingIds = new Set(currentFeed.map(item => item.id));
      
      // NEW: Track topics already in the feed to ensure diversity
      const topicsInCurrentFeed = new Set(currentFeed.map(item => item.topic));
      console.log(`[Feed] Topics already in current feed: ${Array.from(topicsInCurrentFeed).join(', ')}`);
      
      // Get questions that aren't already in our feed
      const availableQuestions = feedData.filter(item => !existingIds.has(item.id));
      
      // Force cold start strategy during cold start phase (position <= 20)
      const totalInteractions = Object.keys(updatedProfile.interactions || {}).length;
      const totalQuestionsAnswered = updatedProfile.totalQuestionsAnswered || 0;
      const forceColdStart = checkpointPosition <= 20; // Always use cold start logic for checkpoints <= 20
      
      console.log(`[Feed] Checkpoint ${checkpointPosition}: Using ${forceColdStart ? 'cold start' : 'personalized'} logic`);
      console.log(`[Feed] Current state: totalInteractions=${totalInteractions}, totalQuestionsAnswered=${totalQuestionsAnswered}`);
      
      // Set temporary flag to ensure cold start logic is used
      if (forceColdStart) {
        // Make a deep copy to avoid modifying the original
        const tempProfile = JSON.parse(JSON.stringify(updatedProfile));
        
        // Make sure coldStartComplete is false to trigger cold start logic
        tempProfile.coldStartComplete = false;
        
        // NEW: Update the cold start state to include the already shown topics in this session
        if (tempProfile.coldStartState) {
          try {
            const coldStartState = JSON.parse(JSON.stringify(tempProfile.coldStartState));
            
            // Make sure topicsShown includes all topics we've shown in this session
            if (Array.isArray(coldStartState.topicsShown)) {
              const existingTopicsShown = new Set(coldStartState.topicsShown);
              
              // Add current feed topics to the topics shown
              topicsInCurrentFeed.forEach(topic => {
                if (!existingTopicsShown.has(topic)) {
                  coldStartState.topicsShown.push(topic);
                  console.log(`[Feed] Added topic ${topic} to cold start state topicsShown`);
                }
              });
            }
            
            // NEW: Update the recentTopics array to include the most recent topics
            if (Array.isArray(coldStartState.recentTopics)) {
              // Get the 5 most recent topics from current feed (last 5 items)
              const recentFeedTopics = currentFeed.slice(-5).map(item => item.topic).reverse();
              
              // Create a new recentTopics array with the most recent feed topics first
              coldStartState.recentTopics = [...recentFeedTopics, 
                ...coldStartState.recentTopics.filter((t: string) => !recentFeedTopics.includes(t))
              ].slice(0, 5);
              
              console.log(`[Feed] Updated recentTopics in cold start state: ${coldStartState.recentTopics.join(', ')}`);
            }
            
            // NEW: Update the lastSelectedTopics array to include the most recent topics
            if (Array.isArray(coldStartState.lastSelectedTopics)) {
              // Get the 4 most recent topics from current feed (last 4 items)
              const lastSelectedFeedTopics = currentFeed.slice(-4).map(item => item.topic).reverse();
              
              // Create a new lastSelectedTopics array with the most recent feed topics first
              coldStartState.lastSelectedTopics = [...lastSelectedFeedTopics, 
                ...coldStartState.lastSelectedTopics.filter((t: string) => !lastSelectedFeedTopics.includes(t))
              ].slice(0, 4);
              
              console.log(`[Feed] Updated lastSelectedTopics in cold start state: ${coldStartState.lastSelectedTopics.join(', ')}`);
            }
            
            // Update the temp profile with the modified cold start state
            tempProfile.coldStartState = coldStartState;
          } catch (e) {
            console.error('[Feed] Error updating cold start state:', e);
          }
        }
        
        // Force the client-side weights to be used instead of any potentially stale weights
        // Ensure the topics from Redux userProfile are properly included
        if (userProfile && userProfile.topics) {
          console.log(`[Feed] Using latest client-side weights from userProfile`);
          // Log each topic weight for debugging
          Object.entries(userProfile.topics).forEach(([topic, data]) => {
            console.log(`[Feed] Topic '${topic}' weight: ${data.weight}`);
            // Ensure tempProfile has the latest weights from redux store
            if (!tempProfile.topics[topic]) {
              tempProfile.topics[topic] = { ...data };
            } else {
              tempProfile.topics[topic].weight = data.weight;
            }
          });
        }
        
        // Log the complete profile for debugging
        console.log(`[Feed] Final profile for question selection: ${JSON.stringify(tempProfile.topics, null, 2)}`);
        
        // Determine the correct phase based on checkpoint position
        let forcedPhase: 'exploration' | 'branching' | 'normal' | undefined;
        
        if (checkpointPosition < 5) {
          forcedPhase = 'exploration'; // Positions 1-4 use exploration phase
          console.log(`[Feed] Forcing exploration phase at position ${checkpointPosition}`);
        } else if (checkpointPosition < 20) {
          forcedPhase = 'branching'; // Positions 5-19 use branching phase
          console.log(`[Feed] Forcing branching phase at position ${checkpointPosition}`);
        } else {
          forcedPhase = 'normal'; // Position 20+ use normal phase
          console.log(`[Feed] Forcing normal phase at position ${checkpointPosition}`);
        }
        
        // Import getColdStartFeed from the coldStartStrategy
        const { getColdStartFeed } = require('../../lib/coldStartStrategy');
        
        // Use the cold start feed generator with the forced phase
      const { items: personalizedItems, explanations: personalizedExplanations } = 
          getColdStartFeed(availableQuestions, tempProfile, undefined, forcedPhase);
        
      // Take only questions we don't already have
        const newQuestions = personalizedItems.filter((item: FeedItemType) => !existingIds.has(item.id)).slice(0, 4);
      
      if (newQuestions.length > 0) {
          console.log(`[Feed] Appending ${newQuestions.length} cold start questions at checkpoint position ${checkpointPosition}`);
          
          // Log which topics were selected for debugging
          const selectedTopics = newQuestions.map((q: FeedItemType) => q.topic);
          console.log(`[Feed] Selected topics at checkpoint ${checkpointPosition}: ${selectedTopics.join(', ')}`);
          
          // NEW: Log how many unique topics we have for diversity check
          const allTopicsAfterAddition = new Set([...topicsInCurrentFeed, ...selectedTopics]);
          console.log(`[Feed] Feed will have ${allTopicsAfterAddition.size} unique topics after addition`);
          
          // Log if these are exploration or branching questions
          const isExploration = checkpointPosition === 4; // First checkpoint is exploration
          const isBranching = checkpointPosition > 4 && checkpointPosition <= 20; // 8, 12, 16, 20 are branching
          console.log(`[Feed] Question type: ${isExploration ? 'Exploration' : isBranching ? 'Branching' : 'Normal'}`);
        
        // Create a new feed with existing + new questions
        const updatedFeed = [...currentFeed, ...newQuestions];
        
        // Add additional explanation about why we added them
        const combinedExplanations: Record<string, string[]> = { ...feedExplanations };
        
        // Add the explanations from the personalization system plus our position message
        newQuestions.forEach((item: FeedItemType) => {
          combinedExplanations[item.id] = [
            ...(personalizedExplanations[item.id] || []),
            `Added at cold start checkpoint position ${checkpointPosition}`
          ];
        });
        
        // Update the feed in Redux with the combined feed
        dispatch(setPersonalizedFeed({
          items: updatedFeed,
          explanations: combinedExplanations,
            userId: user?.id || undefined // Handle nullable user
        }));
      } else {
        console.log(`[Feed] No new questions were found to add at checkpoint ${checkpointPosition}`);
        }
      } else {
        // Use standard personalization logic for positions > 20
        const { items: personalizedItems, explanations: personalizedExplanations } = 
          getPersonalizedFeed(availableQuestions, updatedProfile, 4);
        
        // Take only questions we don't already have
        const newQuestions = personalizedItems.filter((item: FeedItemType) => !existingIds.has(item.id)).slice(0, 4);
        
        if (newQuestions.length > 0) {
          console.log(`[Feed] Appending ${newQuestions.length} personalized questions at checkpoint position ${checkpointPosition}`);
          
          // Create a new feed with existing + new questions
          const updatedFeed = [...currentFeed, ...newQuestions];
          
          // Add additional explanation about why we added them
          const combinedExplanations: Record<string, string[]> = { ...feedExplanations };
          
          // Add the explanations from the personalization system plus our position message
          newQuestions.forEach((item: FeedItemType) => {
            combinedExplanations[item.id] = [
              ...(personalizedExplanations[item.id] || []),
              `Added at normal checkpoint position ${checkpointPosition}`
            ];
          });
          
          // Update the feed in Redux with the combined feed
          dispatch(setPersonalizedFeed({
            items: updatedFeed,
            explanations: combinedExplanations,
            userId: user?.id || undefined // Handle nullable user
          }));
        } else {
          console.log(`[Feed] No new questions were found to add at checkpoint ${checkpointPosition}`);
        }
      }
    } else {
      console.log('[Feed] No additional questions available in feedData for checkpoint');
    }
  }, [feedData, personalizedFeed, feedExplanations, dispatch, user, userProfile]);

  // Add debug logs to markPreviousAsSkipped to identify if it's being called correctly
  const markPreviousAsSkipped = useCallback((prevIndex: number, newIndex: number) => {
    // Only mark as skipped when explicitly scrolling down past a question and if we have feed data
    console.log(`[DEBUG] markPreviousAsSkipped called with prevIndex=${prevIndex}, newIndex=${newIndex}`);
    
    if (prevIndex >= 0 && prevIndex < personalizedFeed.length && newIndex > prevIndex) {
      const previousQuestion = personalizedFeed[prevIndex];
      const previousQuestionId = previousQuestion.id;
      
      // Add special logging for first question
      if (prevIndex === 0) {
        console.log(`[Feed] FIRST QUESTION being marked as skipped: ID ${previousQuestionId}, question "${previousQuestion.question?.substring(0, 30)}..."`)
      } else {
        console.log(`[Feed] Marking question #${prevIndex + 1} as skipped: ID ${previousQuestionId}, question "${previousQuestion.question?.substring(0, 30)}..."`);
      }
      
      // Skip if the question is already marked as skipped or answered
      if (questions[previousQuestionId] && 
          (questions[previousQuestionId].status === 'skipped' || 
           questions[previousQuestionId].status === 'answered')) {
        console.log(`[Feed] Question ${previousQuestionId} already processed (${questions[previousQuestionId].status}), skipping`);
        return;
      }
      
      // Get interaction start time if it exists
      const startTime = interactionStartTimes[previousQuestionId];
      let timeSpent = 0;
      
      if (startTime) {
        timeSpent = Date.now() - startTime;
      }
      
      // Special case for the first question - force longer timeSpent to ensure it's registered
      if (prevIndex === 0) {
        // Force at least 1 second to ensure weight changes register
        timeSpent = Math.max(timeSpent, 1000);
        console.log(`[Feed] FIRST QUESTION: Ensuring minimum timeSpent of 1000ms (actual: ${timeSpent}ms)`);
      }
      
      // Mark question as skipped in Redux
      dispatch(skipQuestion({ 
        questionId: previousQuestionId,
        userId: user?.id
      }));
      
      console.log(`[Feed] Dispatched skipQuestion action for question ${previousQuestionId}`);
      
      // Update user profile with new weight changes
      if (user && user.id) {
        // Create interaction for this skip
        const interaction: Partial<QuestionInteraction> = {
          wasSkipped: true,
          timeSpent
        };
        
        console.log(`[Feed] Updating user profile for skipped question ${previousQuestionId}`);
        console.log(`[Feed] Before skip - topic weights:`, JSON.stringify(userProfile.topics, null, 2));
        
        // Use the personalization service to update the profile
        const result = updateUserProfile(
        userProfile,
        previousQuestionId,
          interaction,
        previousQuestion
      );
      
        console.log(`[Feed] After skip - topic weights:`, JSON.stringify(result.updatedProfile.topics, null, 2));
        console.log(`[Feed] User profile updated, weight change: ${result.weightChange ? 'YES' : 'NO'}`);
        
        if (result.weightChange) {
          console.log(`[Feed] Weight change details: Topic=${result.weightChange.topic}, ${result.weightChange.oldWeights.topicWeight.toFixed(2)} -> ${result.weightChange.newWeights.topicWeight.toFixed(2)}`);
        }
        
        // Save updated profile to Redux BEFORE checkpoint checking
      dispatch(updateUserProfileAction({ 
          profile: result.updatedProfile, 
        userId: user?.id,
          weightChange: result.weightChange || undefined  // Convert null to undefined
      }));

      // Increment skip count
      skipCountRef.current += 1;
      
      // Simple check for adding questions
      // Check if current position (1-indexed) is a checkpoint
      const currentPosition = prevIndex + 1;
      
        // After updating the profile with the skipped question, check for checkpoint
      if (currentPosition <= 20 && shouldAddQuestionsAtPosition(currentPosition)) {
          // IMPORTANT: Using the UPDATED profile with latest weights
          console.log(`[Feed] At checkpoint position ${currentPosition}, adding 4 questions - using UPDATED profile with latest weights`);
        addQuestionsAtCheckpoint(currentPosition, result.updatedProfile);
      } else if (currentPosition > 20) {
        // After position 20 (past cold start) - add 1 question
        console.log('[Feed] Past cold start, adding one question after skip');
        
        // Only proceed if we have feedData to choose from
        if (feedData.length > personalizedFeed.length) {
          // Create a set of IDs that are already in our feed
          const currentFeed = [...personalizedFeed];
          const existingIds = new Set(currentFeed.map(item => item.id));
          
          // Get questions that aren't already in our feed
          const availableQuestions = feedData.filter(item => !existingIds.has(item.id));
          
          if (availableQuestions.length > 0) {
            // Use personalization logic to select new questions
              // IMPORTANT: Use the UPDATED profile here too
            const { items: personalizedItems, explanations: personalizedExplanations } = 
              getPersonalizedFeed(availableQuestions, result.updatedProfile, 1); // Only get 1 question
          
            // Take only the first question
            const newQuestions = personalizedItems.filter(item => !existingIds.has(item.id)).slice(0, 1);
        
            if (newQuestions.length > 0) {
              console.log(`[Feed] Adding 1 personalized question to feed after skip`);
              
              // Create a new feed with existing + new question
              const updatedFeed = [...currentFeed, ...newQuestions];
          
              // Add additional explanation about why we added this question
              const combinedExplanations: Record<string, string[]> = { ...feedExplanations };
          
              // Add the explanations from the personalization system
              newQuestions.forEach((item: FeedItemType) => {
                combinedExplanations[item.id] = [
                  ...(personalizedExplanations[item.id] || []),
                  `Added after question skip`
                ];
              });
          
              // Update the feed in Redux - log dispatch for debugging
              console.log(`[Feed] Dispatching setPersonalizedFeed with ${updatedFeed.length} items`);
              dispatch(setPersonalizedFeed({
                items: updatedFeed,
                explanations: combinedExplanations,
                userId: user?.id || undefined // Handle null user case
              }));
            }
          }
        }
      } else {
        console.log(`[Feed] Not at a checkpoint position (${currentPosition}), not adding questions`);
      }
      } else {
        console.log('[Feed] User not logged in, skipping add question logic');
      }
    } else {
      console.log(`[Feed] Not marking as skipped - invalid indices or not moving forward: prevIndex=${prevIndex}, newIndex=${newIndex}, personalizedFeed.length=${personalizedFeed.length}`);
    }
  }, [personalizedFeed, dispatch, userProfile, user, questions, interactionStartTimes, feedData, feedExplanations, shouldAddQuestionsAtPosition, addQuestionsAtCheckpoint]);

  // Helper function to log feed state for debugging
  const logFeedState = useCallback(() => {
    console.log("===== CURRENT FEED STATE =====");
    console.log(`Feed length: ${personalizedFeed.length} questions`);
    console.log(`Current index: ${currentIndex}`);
    
    // Count topics in feed
    const topicCounts = new Map<string, number>();
    personalizedFeed.forEach(item => {
      const topic = item.topic;
      topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
    });
    
    console.log("Topics in feed:");
    topicCounts.forEach((count, topic) => {
      console.log(`  ${topic}: ${count} questions`);
    });
    
    // Count interactions by type
    let answeredCount = 0;
    let skippedCount = 0;
    let pendingCount = 0;
    
    personalizedFeed.forEach(item => {
      const state = questions[item.id];
      if (!state || state.status === 'unanswered') {
        pendingCount++;
      } else if (state.status === 'skipped') {
        skippedCount++;
      } else if (state.status === 'answered') {
        answeredCount++;
      }
    });
    
    console.log(`Interaction breakdown: ${answeredCount} answered, ${skippedCount} skipped, ${pendingCount} pending`);
    
    // Check user profile
    const totalInteractions = Object.keys(userProfile.interactions || {}).length;
    const totalQuestionsAnswered = userProfile.totalQuestionsAnswered || 0;
    const inColdStart = !userProfile.coldStartComplete && totalQuestionsAnswered < 20;
    
    console.log(`User profile: ${totalInteractions} interactions, ${totalQuestionsAnswered} questions answered`);
    console.log(`Cold start: ${inColdStart ? 'active' : 'complete'}`);
    
    if (inColdStart) {
      // Identify cold start phase
      let phase = 'unknown';
      if (totalQuestionsAnswered < 5) {
        phase = 'exploration (1-5)';
      } else if (totalQuestionsAnswered < 20) {
        phase = 'branching (6-20)';
      }
      console.log(`Cold start phase: ${phase}`);
    }
    
    console.log("===========================");
    
    return { inColdStart, totalInteractions, totalQuestionsAnswered };
  }, [personalizedFeed, currentIndex, questions, userProfile]);

  // Update handleFastScroll to forcibly add questions after a skip
  const handleFastScroll = useCallback((startIndex: number, endIndex: number) => {
    // Don't process if start and end are the same or if scrolling up
    if (startIndex >= endIndex || !personalizedFeed.length) {
      console.log(`[FastScroll] Skipping processing: startIndex=${startIndex}, endIndex=${endIndex}, moving up or same position`);
      return;
    }
    
    console.log(`[FastScroll] Processing fast scroll: ${startIndex} → ~${endIndex}`);
    console.log(`[FastScroll] Before processing, checking feed state:`);
    const { inColdStart, totalInteractions, totalQuestionsAnswered } = logFeedState();
    
    const totalSkipped = Math.min(endIndex - startIndex, 5); // Limit to 5 max questions skipped
    console.log(`[FastScroll] Will attempt to process ${totalSkipped} skipped questions`);

    // Process the skips first
    let skippedCount = 0;
    let highestProcessedIndex = -1;
    
    // Special handling for first question - always check it
    const firstQuestionId = personalizedFeed[0]?.id;
    if (firstQuestionId) {
      const firstQuestionState = questions[firstQuestionId];
      if (!firstQuestionState || firstQuestionState.status === 'unanswered') {
        console.log(`[FastScroll] First question not yet processed, marking as skipped: ${firstQuestionId}`);
        console.log(`[FastScroll] First question topic: ${personalizedFeed[0]?.topic}`);
        markPreviousAsSkipped(0, 1);
        skippedCount++;
        highestProcessedIndex = 0;
      }
    }
    
    // Process remaining questions that aren't already marked
    for (let i = Math.max(1, startIndex); i < endIndex && i < personalizedFeed.length; i++) {
        const question = personalizedFeed[i];
        const questionState = questions[question.id];
        
        // Skip questions that are already processed (answers or skipped)
        if (questionState && (questionState.status === 'answered' || questionState.status === 'skipped')) {
          console.log(`[FastScroll] Question at index ${i} (${question.id}) already processed as ${questionState.status}, skipping`);
          continue;
        }
        
      // Mark as skipped
      console.log(`[FastScroll] Marking question at index ${i} (${question.id}) as skipped`);
      console.log(`[FastScroll] Question topic: ${question.topic}`);
      markPreviousAsSkipped(i, i+1); // Mark this specific question as skipped
      skippedCount++;
      if (i > highestProcessedIndex) {
        highestProcessedIndex = i;
      }
    }
    
    // Now check if we need to add questions - simplified logic
    if (skippedCount > 0) {
      // Check if current position is a checkpoint (4, 8, 12, 16, 20)
      // We use position + 1 because our checkpoints are 1-indexed but array is 0-indexed
      const currentPosition = highestProcessedIndex + 1;
      
      console.log(`[FastScroll] Skipped ${skippedCount} questions, highest index was ${highestProcessedIndex}`);
      console.log(`[FastScroll] Checking if position ${currentPosition} is a checkpoint`);
      
      if (currentPosition <= 20 && shouldAddQuestionsAtPosition(currentPosition)) {
        // At a checkpoint position in cold start - add 4 questions
        console.log(`[FastScroll] At checkpoint position ${currentPosition}, adding 4 questions`);
        addQuestionsAtCheckpoint(currentPosition, userProfile);
      } else if (currentPosition > 20) {
        // After position 20 (past cold start) - add 1 question
        console.log(`[FastScroll] Past cold start (position ${currentPosition}), adding 1 question`);
        
        // Only proceed if we have feedData to choose from
        if (feedData.length > personalizedFeed.length) {
          // Create a set of IDs that are already in our feed
          const currentFeed = [...personalizedFeed];
          const existingIds = new Set(currentFeed.map(item => item.id));
          
          // Get questions that aren't already in our feed
          const availableQuestions = feedData.filter(item => !existingIds.has(item.id));
          
          if (availableQuestions.length > 0) {
            // Use personalization logic to select new questions
            const { items: personalizedItems, explanations: personalizedExplanations } = 
              getPersonalizedFeed(availableQuestions, userProfile, 1); // Only get 1 question
          
            // Take only the first question
            const newQuestions = personalizedItems.filter(item => !existingIds.has(item.id)).slice(0, 1);
        
            if (newQuestions.length > 0) {
              console.log(`[FastScroll] Adding 1 personalized question to feed`);
              console.log(`[FastScroll] Selected topic: ${newQuestions[0].topic}`);
              
              // Create a new feed with existing + new question
              const updatedFeed = [...currentFeed, ...newQuestions];
          
              // Add additional explanation about why we added this question
              const combinedExplanations: Record<string, string[]> = { ...feedExplanations };
          
              // Add the explanations from the personalization system
              newQuestions.forEach((item: FeedItemType) => {
                combinedExplanations[item.id] = [
                  ...(personalizedExplanations[item.id] || []),
                  `Added after skip (past cold start)`
                ];
              });
          
              // Update the feed in Redux - log dispatch for debugging
              console.log(`[FastScroll] Dispatching setPersonalizedFeed with ${updatedFeed.length} items`);
              dispatch(setPersonalizedFeed({
                items: updatedFeed,
                explanations: combinedExplanations,
                userId: user?.id || undefined // Handle nullable user
              }));
            }
          }
        }
      } else {
        console.log(`[FastScroll] Not at a checkpoint position (${currentPosition}), not adding questions`);
      }
      
      // Log feed state after processing
      console.log(`[FastScroll] After processing, checking updated feed state:`);
      logFeedState();
    }
  }, [personalizedFeed, questions, markPreviousAsSkipped, feedData, userProfile, feedExplanations, dispatch, user, addQuestionsAtCheckpoint, shouldAddQuestionsAtPosition, logFeedState]);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (event.nativeEvent.contentOffset.y !== 0 && showTooltip) {
      hideTooltip();
    }
    
    // Clear any pending tooltip timeout when user scrolls
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }
    
    // Mark as actively scrolling
    setIsActivelyScrolling(true);
    
    // Clear any existing timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    
    // Set a timeout to mark as no longer scrolling after a brief period
    scrollTimeoutRef.current = setTimeout(() => {
      setIsActivelyScrolling(false);
    }, 500);
    
    // Check for skipped questions during scroll
    const currentScrollPos = event.nativeEvent.contentOffset.y;
    const scrollDirection = currentScrollPos > lastScrollPosition.current ? 'down' : 'up';
    lastScrollPosition.current = currentScrollPos;
    
    // If scrolling down quickly, check for questions to mark as skipped
    if (scrollDirection === 'down') {
      // Calculate the approximate index based on scroll position
      const estimatedIndex = Math.round(currentScrollPos / viewportHeight);
      
      // If we've moved more than one question, we may have skipped some
      if (estimatedIndex > currentIndex + 1) {
        // Use optimized function to handle fast scroll skipping
        handleFastScroll(currentIndex, estimatedIndex);
      }
    }
  };

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index !== null && personalizedFeed.length > 0) {
        const newIndex = viewableItems[0].index;
        const currentItem = personalizedFeed[newIndex];
        
        if (currentItem && currentItem.id) {
          const currentItemId = currentItem.id;
          const prevIndex = lastVisibleIndexRef.current;
          
          // Enhanced logging to track what's happening
          console.log(`[ViewableItemsChanged] Moving from index ${prevIndex} to ${newIndex}, item ${currentItemId}`);
          
          // Special case for first question skip detection
          if (newIndex === 1 && (prevIndex === null || prevIndex === 0)) {
            // We've moved directly to the second question - check if first question was processed
            const firstQuestionId = personalizedFeed[0].id;
            const firstQuestionState = questions[firstQuestionId];
            
            // Only mark as skipped if it hasn't been processed yet
            if (!firstQuestionState || firstQuestionState.status === 'unanswered') {
              console.log(`[ViewableItemsChanged] First question not yet processed, marking as skipped`);
              markPreviousAsSkipped(0, 1);
            } else {
              console.log(`[ViewableItemsChanged] First question already processed as ${firstQuestionState?.status}`);
            }
          }
          
          // Only process if we've actually moved to a new question
          if (prevIndex !== newIndex) {
            // Check if we're moving forward AND if prevIndex is not null (handles first question case)
            if (prevIndex !== null && newIndex > prevIndex) {
              console.log(`[ViewableItemsChanged] Skipping detected: ${prevIndex} → ${newIndex}`);
              markPreviousAsSkipped(prevIndex, newIndex);
            } else if (prevIndex === null && newIndex > 0) {
              // Handle case where first question was skipped and prevIndex hasn't been set yet
              console.log(`[ViewableItemsChanged] First question possibly skipped, marking index 0`);
              markPreviousAsSkipped(0, newIndex);
            } else {
              console.log(`[ViewableItemsChanged] Moving backwards or special case, not marking as skipped`);
            }
            
            // Update last visible index
            lastVisibleIndexRef.current = newIndex;
            lastVisibleItemId.current = currentItemId;
            
            // Start tracking interaction with new question
            dispatch(startInteraction({ questionId: currentItemId }));
            
            // Set current explanation for debugging
            if (debugPanelVisible && feedExplanations[currentItemId]) {
              setCurrentExplanation(feedExplanations[currentItemId]);
            }
          } else {
            console.log(`[ViewableItemsChanged] Index didn't change, not marking as skipped`);
          }
          
          // Proactively check if we're getting close to the end of the feed (within 3 questions)
          // and append more questions if needed
          if (newIndex >= personalizedFeed.length - 3 && feedData.length > personalizedFeed.length) {
            const currentFeed = [...personalizedFeed];
            const existingIds = new Set(currentFeed.map(item => item.id));
            
            // Get questions that aren't already in our feed and consider weights based on phase
            const availableQuestions = feedData.filter((item: FeedItemType) => {
              const totalQuestionsAnswered = userProfile.totalQuestionsAnswered || 0;
              const isColdStart = !userProfile.coldStartComplete && totalQuestionsAnswered < 20;
              
              // Filter by difficulty based on total questions answered
              const isAppropriateDifficulty = totalQuestionsAnswered < 10 
                ? ['easy', 'medium'].includes(item.difficulty?.toLowerCase() || '')
                : true; // Allow all difficulties after first 10 questions
              
              if (isColdStart) {
                // Phase 1 (Questions 1-5): Pure exploration
                if (totalQuestionsAnswered < 5) {
                  return !existingIds.has(item.id) && isAppropriateDifficulty;
                }
                
                // Phase 2 (Questions 6-12): Begin using initial topic weights
                if (totalQuestionsAnswered < 12) {
                  const isLowWeight = userProfile.topics[item.topic]?.weight < 0.2;
                  return !existingIds.has(item.id) && !isLowWeight && isAppropriateDifficulty;
                }
                
                // Phase 3 (Questions 13-20): Adaptive Personalization
                if (totalQuestionsAnswered < 20) {
                  const isLowWeight = userProfile.topics[item.topic]?.weight < 0.3;
                  return !existingIds.has(item.id) && !isLowWeight;
                }
              } else {
                // Phase 4 (Beyond 20 questions): Steady state
                const isLowWeight = userProfile.topics[item.topic]?.weight < 0.2;
                return !existingIds.has(item.id) && !isLowWeight;
              }
              
              return !existingIds.has(item.id);
            });
            
            // Use personalization logic to select new questions
            const { items: personalizedItems, explanations: personalizedExplanations } = 
              getPersonalizedFeed(availableQuestions, userProfile, 4); // Reduced from 8 to 4
              
            // Take only 2 new personalized questions (reduced from 5)
            const newQuestions = personalizedItems.filter(item => !existingIds.has(item.id)).slice(0, 2);
            
            if (newQuestions.length > 0) {
              // Create a new feed with existing + new questions
              const updatedFeed = [...currentFeed, ...newQuestions];
              
              console.log(`[ViewableItemsChanged] Adding ${newQuestions.length} proactive questions, feed will have ${updatedFeed.length} items`);
              
              // Add additional explanation about why we added them
              const combinedExplanations: Record<string, string[]> = { ...feedExplanations };
              
              // Add the explanations from the personalization system plus our message
              newQuestions.forEach((item: FeedItemType) => {
                const totalQuestionsAnswered = userProfile.totalQuestionsAnswered || 0;
                let phaseMessage = '';
                
                if (!userProfile.coldStartComplete && totalQuestionsAnswered < 20) {
                  if (totalQuestionsAnswered < 5) {
                    phaseMessage = 'Added during initial exploration phase';
                  } else if (totalQuestionsAnswered < 12) {
                    phaseMessage = 'Added during topic weight discovery phase';
                  } else {
                    phaseMessage = 'Added during adaptive personalization phase';
                  }
                } else {
                  phaseMessage = 'Added during steady state phase';
                }
                
                combinedExplanations[item.id] = [
                  ...(personalizedExplanations[item.id] || []),
                  phaseMessage
                ];
              });
              
              // Update the feed in Redux
              dispatch(setPersonalizedFeed({
                items: updatedFeed,
                explanations: combinedExplanations,
                userId: user?.id || undefined // Handle nullable user
              }));
            }
          }
        }
      }
    },  // Close the function
    [markPreviousAsSkipped, personalizedFeed, feedExplanations, dispatch, interactionStartTimes, feedData, userProfile, debugPanelVisible, questions, user?.id]  // Dependencies array
  );

  useEffect(() => {
    if (personalizedFeed.length > 0) {
      const firstQuestionId = personalizedFeed[0].id;
      lastVisibleItemId.current = firstQuestionId;
      lastVisibleIndexRef.current = 0; // Explicitly initialize this ref to 0
      
      // Start tracking interaction with first question
      console.log(`Starting initial interaction tracking for question ${firstQuestionId}`);
      
      // Dispatch action to start tracking this question's interaction time
      dispatch(startInteraction({ questionId: firstQuestionId }));
    }
  // Remove interactionStartTimes from dependencies to prevent infinite loop
  }, [personalizedFeed, dispatch]);
  
  // Separate useEffect for verification to prevent infinite loops
  useEffect(() => {
    // Only run once after component mounts to verify first question tracking
    if (personalizedFeed.length > 0) {
      const firstQuestionId = personalizedFeed[0].id;
      
      // Verify after a short delay
      const timer = setTimeout(() => {
        if (interactionStartTimes[firstQuestionId]) {
          console.log(`Confirmed initial interaction tracking for ${firstQuestionId}, start time: ${new Date(interactionStartTimes[firstQuestionId]).toISOString()}`);
        } else {
          console.warn(`Failed to start initial interaction tracking for ${firstQuestionId}`);
        }
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [personalizedFeed.length]); // Only run when feed length changes

  const viewabilityConfig = {
    itemVisiblePercentThreshold: 50,
    minimumViewTime: 300, // Question must be visible for at least 300ms to be considered viewed
  };

  const viewabilityConfigCallbackPairs = useRef([
    { viewabilityConfig, onViewableItemsChanged },
  ]);

  const onMomentumScrollBegin = useCallback(() => {
    lastInteractionTime.current = Date.now();
    if (showTooltip) {
      hideTooltip();
    }
    
    // Log scroll movement for debugging
    console.log(`Scroll movement started from question ${currentIndex}`);
  }, [showTooltip, currentIndex]);

  const onMomentumScrollEnd = useCallback(() => {
    const scrollTime = Date.now() - lastInteractionTime.current;
    console.log(`Scroll transition time: ${scrollTime}ms to question ${currentIndex}`);
    
    // Double-check if we need to mark questions as skipped
    if (previousIndex.current !== currentIndex && previousIndex.current < currentIndex) {
      // Use our optimized function to handle any missed skipping
      handleFastScroll(previousIndex.current, currentIndex);
    }
    
    // Update previous index after ensuring skipped questions are marked
    previousIndex.current = currentIndex;
  }, [currentIndex, handleFastScroll]);

  // Add this hook to handle question generation
  const { triggerQuestionGeneration, trackQuestionInteraction } = useQuestionGenerator();

  // Update handleAnswer to track last answer time
  const handleAnswer = useCallback(async (
    questionId: string, 
    selectedOption: number,
    selectedAnswer: string,
    isCorrect: boolean,
    timestamp: number = Date.now(),
    duration: number = 0
  ) => {
    const questionItem = personalizedFeed.find(item => item.id === questionId);
    if (!questionItem) return;
    
    // Find the current position/index in the feed (0-indexed)
    const currentIndex = personalizedFeed.findIndex(item => item.id === questionId);
    // Convert to 1-indexed position for our checkpoints
    const currentPosition = currentIndex + 1;
    
    // Get interaction start time if it exists
    const startTime = interactionStartTimes[questionId];
    let timeSpent = 0;
    
    if (startTime) {
      timeSpent = Date.now() - startTime;
      console.log(`Time spent answering question ${questionId}: ${timeSpent}ms`);
    } else {
      console.log(`Warning: No start time recorded for answered question ${questionId}`);
    }
    
    // Get the user ID from auth context
    const userId = user?.id;
    
    // Update user profile for personalization
    const { updatedProfile, weightChange } = updateUserProfile(
      userProfile,
      questionId,
      {
        wasCorrect: isCorrect,
        wasSkipped: false,
        timeSpent: timeSpent
      },
      questionItem
    );
    
    // IMPORTANT: Save a copy of the current feed before updating the profile
    // This prevents the feed from being regenerated by other useEffects
    const currentFeed = [...personalizedFeed];
    
    // Dispatch answer action to mark question as answered
    dispatch(answerQuestion({ 
      questionId, 
      answerIndex: selectedOption, 
      isCorrect,
      userId: user?.id // Pass user ID if available
    }));
    
    // Save updated profile to Redux
    // Let the Redux action handle the syncing with Supabase
    dispatch(updateUserProfileAction({ 
      profile: updatedProfile, 
      userId: user?.id,
      weightChange: weightChange || undefined // Convert null to undefined to match expected type
    }));
    
    // Simple logic for adding questions based on position
    if (feedData.length > currentFeed.length) {
      if (currentPosition <= 20 && shouldAddQuestionsAtPosition(currentPosition)) {
        // At a checkpoint position in cold start - add 4 questions
        console.log(`[Feed] At checkpoint position ${currentPosition}, adding 4 questions`);
        addQuestionsAtCheckpoint(currentPosition, updatedProfile);
      } else if (currentPosition > 20) {
        // After position 20 (past cold start) - add 1 question
        console.log(`[Feed] Past cold start (position ${currentPosition}), adding 1 question`);
        
        // Create a set of IDs that are already in our feed
        const existingIds = new Set(currentFeed.map(item => item.id));
        
        // Get questions that aren't already in our feed
        const availableQuestions = feedData.filter(item => !existingIds.has(item.id));
        
        // Use personalization logic to select new questions
        const { items: personalizedItems, explanations: personalizedExplanations } = 
          getPersonalizedFeed(availableQuestions, updatedProfile, 1); // Only get 1 question in normal state
          
        // Take only one question
        const newQuestions = personalizedItems.filter(item => !existingIds.has(item.id)).slice(0, 1);
        
        if (newQuestions.length > 0) {
          console.log(`[Feed] Appending 1 personalized question after interaction`);
          
          // Create a new feed with existing + new questions
          const updatedFeed = [...currentFeed, ...newQuestions];
          
          // Add additional explanation about why we added them
          const combinedExplanations: Record<string, string[]> = { ...feedExplanations };
          
          // Add the explanations from the personalization system
          newQuestions.forEach((item: FeedItemType) => {
            combinedExplanations[item.id] = [
              ...(personalizedExplanations[item.id] || []),
              `Added after question interaction`
            ];
          });
          
          // Update the feed in Redux
          dispatch(setPersonalizedFeed({
            items: updatedFeed,
            explanations: combinedExplanations,
            userId: user?.id || undefined // Handle nullable user
          }));
        }
      } else {
        console.log(`[Feed] Not at a checkpoint position (${currentPosition}), not adding questions`);
      }
    }
    
    // Remove auto-scrolling behavior - let users control when to move to next question
    // The user can swipe up manually when ready to see the next question
    
    console.log(
      'Answered question:', 
      questionId, 
      'Correct:', 
      isCorrect, 
      'Time:', 
      timeSpent,
      'Tags:',
      questionItem.tags || 'None'
    );

    // Track this question interaction in client-side storage for better topic generation
    if (user?.id) {
      // Debug: log the full question item to see what properties are available
      console.log('\n\n====================== ANSWER TRACKING LOGS ======================');
      console.log('[FEED] Question properties available:');
      Object.keys(questionItem).forEach(key => {
        console.log(`  - ${key}: ${JSON.stringify((questionItem as any)[key])}`);
      });
      
      // Track client-side interaction data for personalized topic generation
      trackQuestionInteraction(
        user.id, 
        questionId, 
        questionItem.topic || 'Unknown',
        // Handle optional properties safely
        (questionItem as any).subtopic || undefined,
        (questionItem as any).branch || undefined,
        questionItem.tags || [],
        questionItem.question // Pass the question text
      );
      
      // Log the client-side data being tracked
      console.log('[FEED] Tracked client-side interaction data:', {
        questionId,
        topic: questionItem.topic || 'Unknown',
        subtopic: (questionItem as any).subtopic || undefined,
        branch: (questionItem as any).branch || undefined,
        tags: questionItem.tags || [],
        questionText: questionItem.question
      });
      console.log('====================== END ANSWER TRACKING LOGS ======================\n\n');
    }

    // Use a short timeout to prevent multiple rapid calls
    console.log('[FEED] Attempting to trigger question generation for user:', user?.id);
    // Only call once, with a slight delay to ensure Redux state is updated
    setTimeout(() => {
      // This will now use our client-side counter to determine if generation is needed
      if (user?.id) {
        triggerQuestionGeneration(user?.id).catch(error => {
          console.error('Error triggering question generation:', error);
        });
      }
    }, 300); // Reduced timeout for better responsiveness

    // Track when the user last answered a question
    setLastAnswerTime(Date.now());
  }, [dispatch, personalizedFeed, userProfile, interactionStartTimes, feedData, feedExplanations, user, triggerQuestionGeneration, trackQuestionInteraction]);

  // Modify handleNextQuestion to be more controlled and prevent unexpected scrolling
  const handleNextQuestion = useCallback(() => {
    // Only scroll to next question when explicitly requested via the button
    if (flatListRef.current && currentIndex < personalizedFeed.length - 1) {
      const targetIndex = currentIndex + 1;
      
      // Use scrollToOffset instead of scrollToIndex for more stable scrolling
      const offset = viewportHeight * targetIndex;
      
      flatListRef.current.scrollToOffset({
        offset,
        animated: true
      });
    } else if (currentIndex >= personalizedFeed.length - 2) {
      // We're near the end of the feed, let's add more questions if available
      console.log('Near end of feed, checking if we can append more questions');
      
      // Find questions we don't already have in our feed
      const existingIds = new Set(personalizedFeed.map(item => item.id));
      const availableQuestions = feedData.filter(item => !existingIds.has(item.id));
      
      // Take up to 5 new questions to append
      const newQuestions = availableQuestions.slice(0, 5);
      
      if (newQuestions.length > 0) {
        console.log(`Appending ${newQuestions.length} more questions to feed`);
        
        // Create a new feed with existing + new questions
        const updatedFeed = [...personalizedFeed, ...newQuestions];
        
        // Create empty explanations for new questions
        const newExplanations: Record<string, string[]> = {};
        newQuestions.forEach((item: FeedItemType) => {
          newExplanations[item.id] = [`Added to extend feed`];
        });
        
        // Combine explanations
        const combinedExplanations = {
          ...feedExplanations,
          ...newExplanations
        };
        
        // Update the feed in Redux
        dispatch(setPersonalizedFeed({
          items: updatedFeed,
          explanations: combinedExplanations
        }));
        
        // After updating feed, scroll to the next question
        setTimeout(() => {
          if (flatListRef.current) {
            const targetIndex = currentIndex + 1;
            const offset = viewportHeight * targetIndex;
            
            flatListRef.current.scrollToOffset({
              offset,
              animated: true
            });
          }
        }, 100);
      }
    }
  }, [currentIndex, personalizedFeed, viewportHeight, feedData, feedExplanations, dispatch]);

  // Add a function to toggle the leaderboard
  const toggleLeaderboard = useCallback((itemId?: string) => {
    if (itemId) {
      setCurrentLeaderboardItemId(itemId);
    }
    setShowLeaderboard(prev => !prev);
  }, []);

  const renderItem = ({ item, index }: { item: FeedItemType; index: number }) => {
    // Add debug logging for duplicate detection and feed stability
    console.log(`Rendering item ${index}: ${item.id} - "${item.question.substring(0, 30)}..."`, 
      questions[item.id] ? `(Question status: ${questions[item.id].status})` : '(No status yet)');
    
    return (
      <View style={[styles.itemContainer, { width, height: viewportHeight }]}>
        <FeedItem 
          item={item} 
          onAnswer={(answerIndex, isCorrect) => 
            handleAnswer(item.id, answerIndex, item.question, isCorrect)
          }
          showExplanation={() => {
            // Show explanation only when debug panel is visible
            if (debugPanelVisible && feedExplanations[item.id]) {
              setCurrentExplanation(feedExplanations[item.id]);
              setShowExplanationModal(true);
            }
          }}
          onNextQuestion={handleNextQuestion}
          onToggleLeaderboard={() => toggleLeaderboard(item.id)}
        />
      </View>
    );
  };

  const keyExtractor = (item: FeedItemType, index: number) => {
    // Ensure key is always unique even if duplicate IDs exist
    return `${item.id}-${index}`;
  };

  // Get item layout with responsive height
  const getItemLayout = (_: any, index: number) => {
    return {
      length: viewportHeight,
      offset: viewportHeight * index,
      index,
    };
  };

  // Add this function inside FeedScreen component to determine if we're in cold start mode
  const getColdStartPhaseInfo = useCallback(() => {
    const totalInteractions = Object.keys(userProfile?.interactions || {}).length;
    const totalQuestionsAnswered = userProfile?.totalQuestionsAnswered || 0;
    
    if (!userProfile?.coldStartComplete && (totalInteractions < 20 || totalQuestionsAnswered < 20)) {
      let phase = 1;
      if (totalQuestionsAnswered >= 12) {
        phase = 3;
      } else if (totalQuestionsAnswered >= 3) {
        phase = 2;
      } else {
        phase = 1;
      }
      
      return {
        inColdStart: true,
        phase,
        questionsInPhase: totalQuestionsAnswered,
        phaseDescription: getPhaseDescription(phase)
      };
    }
    
    // When not in cold start, still return all properties with default values
    return { 
      inColdStart: false,
      phase: 4,  // Assume phase 4 (steady state)
      questionsInPhase: totalQuestionsAnswered,
      phaseDescription: getPhaseDescription(4)
    };
  }, [userProfile]);

  // Helper function to get phase description
  const getPhaseDescription = (phase: number) => {
    switch (phase) {
      case 1:
        return "Seeding: Detecting your preferences";
      case 2:
        return "Initial Branching: Learning your interests";
      case 3:
        return "Adaptive Personalization: Refining your feed";
      case 4:
        return "Steady State: Optimized for you";
      default:
        return "Personalizing your feed";
    }
  };

  // Toggle profile modal
  const toggleProfile = () => {
    setShowProfile(!showProfile);
  };

  // Get user profile when component mounts
  useEffect(() => {
    const fetchUserProfile = async () => {
      if (!user) return;
      
      try {
        const { data, error } = await supabase
          .from('user_profiles')
          .select('avatar_url')
          .eq('id', user?.id)
          .single();
        
        if (error) {
          console.error('Error fetching user profile:', error);
          return;
        }
        
        if (data && data.avatar_url) {
          setAvatarUrl(data.avatar_url);
        }
      } catch (error) {
        console.error('Error in fetchUserProfile:', error);
      }
    };
    
    fetchUserProfile();
  }, [user]);

  // Check URL parameters for debug mode
  useEffect(() => {
    // Function to check URL parameters
    const checkUrlParams = () => {
      if (Platform.OS === 'web') {
        try {
          const urlParams = new URLSearchParams(window.location.search);
          const debugParam = urlParams.get('debug');
          console.log('URL Params check - debug param:', debugParam);
          
          // Only enable if exact parameter match
          if (debugParam === 'trivia-debug-panel') {
            console.log('Debug panel enabled via URL parameter');
            setDebugPanelVisible(true);
          } else {
            console.log('Debug panel hidden (no valid URL param)');
            // Only reset debug panel visibility if not on iOS (where gesture can toggle it)
            setDebugPanelVisible(false);
          }
        } catch (error) {
          console.error('Error parsing URL parameters:', error);
        }
      }
    };
    
    // Check URL parameters immediately
    checkUrlParams();
    
    // Set up listener for URL changes in web platform
    if (Platform.OS === 'web') {
      // Use the History API to detect changes
      const handlePopState = () => {
        console.log('URL changed, rechecking parameters');
        checkUrlParams();
      };
      
      // Listen for URL changes
      window.addEventListener('popstate', handlePopState);
      window.addEventListener('hashchange', handlePopState);
      
      // Also track the current URL to detect any changes
      let previousUrl = window.location.href;
      
      // Set up an interval to check for URL changes (handles programmatic changes)
      const intervalId = setInterval(() => {
        const currentUrl = window.location.href;
        if (previousUrl !== currentUrl) {
          previousUrl = currentUrl;
          console.log('URL changed programmatically, rechecking parameters');
          checkUrlParams();
        }
      }, 500); // Check every 500ms
      
      // Clean up listeners when component unmounts
      return () => {
        window.removeEventListener('popstate', handlePopState);
        window.removeEventListener('hashchange', handlePopState);
        clearInterval(intervalId);
      };
    }
  }, []);
  
  // Add state for debug toast visibility
  const [showDebugToast, setShowDebugToast] = useState(false);
  const debugToastOpacity = useRef(new Animated.Value(0)).current;
  
  // Handle 3-finger tap for iOS
  const handleTouchStart = useCallback((event: GestureResponderEvent) => {
    // Check if it's a 3-finger tap on iOS
    if (Platform.OS === 'ios' && 
        event.nativeEvent.touches && 
        event.nativeEvent.touches.length === 3) {
      console.log('3-finger tap detected on iOS, toggling debug panel');
      
      // Toggle debug panel
      setDebugPanelVisible(prev => !prev);
      
      // Show visual feedback toast
      setShowDebugToast(true);
      Animated.sequence([
        Animated.timing(debugToastOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.delay(1500),
        Animated.timing(debugToastOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setShowDebugToast(false);
      });
    }
  }, [debugPanelVisible]);

  // Function to toggle debug mode via URL parameter on web
  const toggleDebugModeViaUrl = useCallback(() => {
    if (Platform.OS === 'web') {
      const currentUrl = new URL(window.location.href);
      const params = new URLSearchParams(currentUrl.search);
      
      if (params.has('debug') && params.get('debug') === 'trivia-debug-panel') {
        // Remove debug parameter if it exists
        params.delete('debug');
        console.log('Removing debug parameter from URL');
      } else {
        // Add debug parameter
        params.set('debug', 'trivia-debug-panel');
        console.log('Adding debug parameter to URL');
      }
      
      // Update URL without reloading the page
      currentUrl.search = params.toString();
      window.history.pushState({}, '', currentUrl.toString());
      
      // Manually trigger a check of URL parameters
      const urlParams = new URLSearchParams(window.location.search);
      const debugParam = urlParams.get('debug');
      
      if (debugParam === 'trivia-debug-panel') {
        setDebugPanelVisible(true);
      } else {
        setDebugPanelVisible(false);
      }
      
      // Show visual feedback
      setShowDebugToast(true);
      Animated.sequence([
        Animated.timing(debugToastOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.delay(1500),
        Animated.timing(debugToastOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setShowDebugToast(false);
      });
    }
  }, [debugToastOpacity]);

  // Show debug instructions on web after component mounts
  useEffect(() => {
    if (Platform.OS === 'web' && __DEV__) {
      // Wait a moment before showing the tip
      const timerId = setTimeout(() => {
        console.log('%cTIP: Use ?debug=trivia-debug-panel in the URL to enable debug mode', 'color: #4CAF50; font-size: 16px; font-weight: bold;');
        console.log('%cOr use Alt+D keyboard shortcut to toggle debug mode', 'color: #2196F3; font-size: 14px;');
      }, 2000);
      
      return () => clearTimeout(timerId);
    }
  }, []);

  // Add keyboard shortcut for toggling debug mode on web
  useEffect(() => {
    if (Platform.OS === 'web') {
      const handleKeyDown = (event: KeyboardEvent) => {
        // Alt+D shortcut to toggle debug mode
        if (event.altKey && event.key === 'd') {
          event.preventDefault();
          toggleDebugModeViaUrl();
        }
      };
      
      window.addEventListener('keydown', handleKeyDown);
      
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [toggleDebugModeViaUrl]);

  // Add useTheme hook in the component
  const { isNeonTheme } = useTheme();

  // Update error handling to use AppLoadingContext
  if (loadError) {
    // Make sure to signal that app loading is complete
    useEffect(() => {
      setIsAppLoading(false);
    }, []);

    return (
      <View style={styles.container}>
        <ThemedLoadingScreen message={loadError || "Error loading questions"} />
        <TouchableOpacity 
          style={[
            isNeonTheme ? styles.neonRetryButton : styles.retryButton,
            Platform.OS === 'ios' && isNeonTheme ? styles.neonRetryButtonIOS : null
          ]}
          onPress={() => {
            // Set loading back to true when retrying
            setIsAppLoading(true);
            fetchTriviaQuestions().then((questions: FeedItemType[]) => {
              setFeedData(questions);
              setLoadError(null);
              setIsAppLoading(false);
            }).catch((err: Error) => {
              console.error('Retry failed:', err);
              setLoadError('Failed to load questions. Please try again later.');
              setIsAppLoading(false);
            });
          }}
        >
          <ThemedText style={isNeonTheme ? styles.neonRetryText : styles.retryButtonText}>Retry</ThemedText>
        </TouchableOpacity>
      </View>
    );
  }

  // Add the hideTooltip function that was removed
  const hideTooltip = () => {
    try {
      // Stop animation and clean up
      if (tikTokAnimation.current) {
        tikTokAnimation.current.stop();
        tikTokAnimation.current = null;
      }

      // First set state updates before animation
      if (!hasViewedTooltip) {
        // Use permanentlyDismissTooltip instead of markTooltipAsViewed to prevent reappearance
        dispatch(permanentlyDismissTooltip());
      } else {
        // If they've seen it before but now explicitly dismiss it, mark as permanently dismissed
        dispatch(permanentlyDismissTooltip());
      }
      
      // Create a separate function to handle animation completion
      const handleAnimationComplete = () => {
        resetAnimations();
      };
      
      // Set the state directly first
      setShowTooltip(false);
      setShouldShowTooltip(false);
      
      // Then run animation, state is already updated
      animateOut(handleAnimationComplete);
    } catch (error) {
      console.error('Error hiding tooltip:', error);
      // Fall back to direct state update if animation fails
      setShowTooltip(false);
      setShouldShowTooltip(false);
      dispatch(permanentlyDismissTooltip());
      resetAnimations();
    }
  };

  return (
    <View 
      style={[styles.container, { backgroundColor }]}
      onTouchStart={handleTouchStart}
    >
      {/* Profile Button with User Avatar */}
      <TouchableOpacity 
        style={styles.profileButton} 
        onPress={toggleProfile}
      >
        <View style={styles.avatarCircle}>
          {isGuest ? (
            // If in guest mode, use the guest avatar image
            <Image 
              source={require('../../../assets/images/guest-avatar.png')} 
              style={styles.avatar}
              resizeMode="cover"
            />
          ) : avatarUrl ? (
            // If user has an avatar, use it
            <Image source={{ uri: avatarUrl }} style={styles.avatar} />
          ) : (
            // Otherwise show initials
            <ThemedText style={styles.avatarText}>{getInitials()}</ThemedText>
          )}
        </View>
      </TouchableOpacity>

      {/* Connection error banner */}
      {usingMockData && (
        <Surface style={styles.mockDataBanner}>
          <Text style={styles.mockDataText}>
            Using sample questions due to network connectivity issues. Please check your connection.
          </Text>
        </Surface>
      )}
      
      {/* Debug toast notification */}
      {showDebugToast && (
        <Animated.View style={[styles.debugToast, { opacity: debugToastOpacity }]}>
          <ThemedText style={styles.debugToastText}>
            Debug Mode: {debugPanelVisible ? 'ON' : 'OFF'}
          </ThemedText>
        </Animated.View>
      )}
      
      <FlatList
        ref={flatListRef}
        data={personalizedFeed.length > 0 ? personalizedFeed : feedData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        showsVerticalScrollIndicator={false}
        pagingEnabled={true}
        getItemLayout={getItemLayout}
        viewabilityConfigCallbackPairs={viewabilityConfigCallbackPairs.current}
        onMomentumScrollBegin={onMomentumScrollBegin}
        onMomentumScrollEnd={onMomentumScrollEnd}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        snapToAlignment="start"
        decelerationRate="fast" // Use fast deceleration for better snapping
        snapToInterval={viewportHeight}
        style={styles.flatList}
        contentContainerStyle={styles.flatListContent}
        removeClippedSubviews={Platform.OS !== 'web'} // Improve performance on mobile but can cause issues on web
        maxToRenderPerBatch={3}
        windowSize={5} // Increase window size for better visibility detection
        initialNumToRender={2}
        updateCellsBatchingPeriod={50} // Optimize batch updates
        maintainVisibleContentPosition={{ // Help maintain position during dynamic content changes
          minIndexForVisible: 0,
          autoscrollToTopThreshold: 10
        }}
      />

      {/* InteractionTracker Component */}
      <InteractionTracker 
        feedData={personalizedFeed.length > 0 ? personalizedFeed : feedData} 
        debugEnabled={debugPanelVisible}
      />

      {/* Profile Bottom Sheet */}
      <ProfileBottomSheet isVisible={showProfile} onClose={toggleProfile} />

      {/* Leaderboard Bottom Sheet */}
      <LeaderboardBottomSheet isVisible={showLeaderboard} onClose={toggleLeaderboard} />

      {/* Debugging Modal for Personalization Explanations - Only visible when debug panel is enabled */}
      {debugPanelVisible && showExplanationModal && (
        <Portal>
          <Modal 
            visible={showExplanationModal} 
            onDismiss={() => setShowExplanationModal(false)}
            contentContainerStyle={styles.explanationModal}
          >
            <Card>
              <Card.Header title="Question Selection Logic" />
              <Card.Content>
                {currentExplanation.map((explanation, i) => (
                  <Text key={i} style={[styles.explanationText, { color: textColor }]}>
                    {explanation}
                  </Text>
                ))}
              </Card.Content>
              <Card.Footer>
                <PaperButton 
                  mode="contained"
                  onPress={() => setShowExplanationModal(false)}
                >
                  Close
                </PaperButton>
              </Card.Footer>
            </Card>
          </Modal>
        </Portal>
      )}

      {/* Debug Panel Button - Only visible when debug panel is explicitly enabled */}
      {debugPanelVisible && (
        <TouchableOpacity 
          style={styles.debugButton}
          onPress={() => {
            console.log('Debug button pressed');
            if (currentIndex < personalizedFeed.length) {
              const currentItemId = personalizedFeed[currentIndex].id;
              setCurrentExplanation(feedExplanations[currentItemId] || ['No explanation available for this question']);
              setShowExplanationModal(true);
            }
          }}
        >
          <View style={styles.debugButtonInner}>
            <ThemedText style={styles.debugButtonText}>DEBUG</ThemedText>
          </View>
        </TouchableOpacity>
      )}

      {showTooltip && (
        <View style={{
          position: 'absolute',
          bottom: 80,
          left: 0,
          right: 0,
          width: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: zIndex.tooltip - 10,
        }}>
          <Animated.View
            style={[
              styles.tooltip,
              {
                opacity,
                transform: [{ scale }],
                backgroundColor: backgroundColor,
                borderColor: borderColor,
              },
            ]}
          >
            <View style={[
              styles.tooltipArrow,
              { borderTopColor: backgroundColor }
            ]} />
            <Text style={[
              styles.tooltipText,
              { color: textColor }
            ]}>
              {Platform.OS === 'web' 
                ? 'Use arrow keys to navigate' 
                : 'Swipe up for next question!'}
            </Text>

            <View style={styles.tiktokAnimationContainer}>
              <View style={[
                styles.phoneFrame,
                { borderColor: borderColor }
              ]}>
                <View style={styles.phoneContent}>
                  <Animated.View
                    style={[
                      styles.mockScreen,
                      styles.mockScreen1,
                      { transform: [{ translateY: mockContent1 }] },
                    ]}
                  />
                  <Animated.View
                    style={[
                      styles.mockScreen,
                      styles.mockScreen2,
                      { transform: [{ translateY: mockContent2 }] },
                    ]}
                  />
                </View>

                <Animated.View
                  style={[
                    styles.finger,
                    {
                      transform: [
                        { translateY: fingerPosition },
                        { translateX: 22 },
                      ],
                    },
                  ]}
                >
                  <View style={styles.fingerElement}>
                    <View style={styles.fingerTip} />
                  </View>
                  <View style={styles.fingerShadow} />
                </Animated.View>
              </View>
            </View>

            <PaperButton
              mode="contained"
              onPress={hideTooltip}
              style={[styles.tooltipButton, { backgroundColor: primaryColor }]}
              labelStyle={[styles.tooltipButtonLabel, { color: '#000000' }]}
            >
              Got it
            </PaperButton>
          </Animated.View>
        </View>
      )}
    </View>
  );
};

export default FeedScreen;