import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Animated,
  Platform,
  TextStyle,
  SafeAreaView,
  Modal,
  ScrollView,
  Image,
  Easing,
  Pressable,
} from 'react-native';
// Try-catch import to handle missing package gracefully
let ExpoAudio: any;
try {
  ExpoAudio = require('expo-av');
} catch (e) {
  console.log('expo-av not available, sound effects will be disabled');
  ExpoAudio = { Sound: null };
}
// Import Haptics directly
import * as Haptics from 'expo-haptics';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { QuestionState } from '../../store/triviaSlice';
import { FeatherIcon } from '@/components/FeatherIcon';
import { ThemedText } from '@/components/ThemedText';
import { useIOSAnimations } from '@/hooks/useIOSAnimations';
import { useThemeColor } from '@/hooks/useThemeColor';
import { useColorScheme } from '@/hooks/useColorScheme';
import Leaderboard from '../../components/Leaderboard';
import { useAuth } from '../../context/AuthContext';
import NeonGradientBackground from '@/src/components/NeonGradientBackground';
import { useTheme } from '@/src/context/ThemeContext';
import { NeonColors, NeonCategoryColors, getCategoryColor } from '@/constants/NeonColors';
import { BlurView } from 'expo-blur';

const { width, height } = Dimensions.get('window');

// Updated type to support multiple answers and add new props
type FeedItemProps = {
  item: {
    id: string;
    question: string;
    answers: {
      text: string;
      isCorrect: boolean;
    }[];
    difficulty: string;
    likes: number;
    views: number;
    backgroundColor: string; // Changed from backgroundImage to backgroundColor
    learningCapsule: string;
    tags?: string[];
    topic: string;
    // category is now optional since we've migrated to using topic
    category?: string;
  };
  onAnswer?: (answerIndex: number, isCorrect: boolean) => void;
  showExplanation?: () => void;
  onNextQuestion?: () => void;
  onToggleLeaderboard?: () => void;
};

const FeedItem: React.FC<FeedItemProps> = ({ item, onAnswer, showExplanation, onNextQuestion, onToggleLeaderboard }) => {
  const [selectedAnswerIndex, setSelectedAnswerIndex] = useState<number | null>(null);
  const [isLiked, setIsLiked] = useState(false);
  const [showLearningCapsule, setShowLearningCapsule] = useState(false);
  const [hoveredAnswerIndex, setHoveredAnswerIndex] = useState<number | null>(null);
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);
  
  const mouseEnterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renderCount = useRef(0);
  
  const fadeAnim = useRef(new Animated.Value(0)).current;
  
  const colorScheme = useColorScheme();
  const { isNeonTheme } = useTheme();
  
  // Add CSS keyframes animation for web platform
  useEffect(() => {
    if (Platform.OS === 'web' && isNeonTheme) {
      // Create a style element
      const styleEl = document.createElement('style');
      // Add keyframes animation with reduced intensity
      styleEl.innerHTML = `
        @keyframes neonPulse {
          0% {
            box-shadow: 0 0 4px currentColor, 0 0 8px rgba(255, 255, 255, 0.2);
            text-shadow: 0 0 2px currentColor;
          }
          100% {
            box-shadow: 0 0 8px currentColor, 0 0 12px rgba(255, 255, 255, 0.2);
            text-shadow: 0 0 3px currentColor;
          }
        }
        
        @keyframes neonTextGlow {
          0% {
            text-shadow: none;
          }
          50% {
            text-shadow: none;
          }
          100% {
            text-shadow: none;
          }
        }
        
        @keyframes categoryNeonGlow {
          0% {
            text-shadow: none;
          }
          50% {
            text-shadow: none;
          }
          100% {
            text-shadow: none;
          }
        }
      `;
      // Append to document head
      document.head.appendChild(styleEl);
      
      // Clean up function
      return () => {
        document.head.removeChild(styleEl);
      };
    }
  }, [isNeonTheme]);
  
  // Add useEffect to create a dynamic glow animation for the neon background
  useEffect(() => {
    // Only apply enhanced glow effects on neon theme
    if (isNeonTheme && Platform.OS === 'web') {
      // Get the category colors for the current item 
      // Support both category and topic fields
      const topicOrCategory = item.category || item.topic || 'default';
      let glowColor = NeonColors.dark.primary; // Default cyan
      
      if (topicOrCategory) {
        // Use the hex color from the category colors
        glowColor = getCategoryColor(topicOrCategory).hex;
      }
      
      // Create a style element for the glowing background effect
      const styleEl = document.createElement('style');
      styleEl.innerHTML = `
        @keyframes bgGlow {
          0% { 
            background-position: 0% 0%;
            opacity: 0.8;
          }
          50% { 
            background-position: 100% 100%;
            opacity: 1;
          }
          100% { 
            background-position: 0% 0%;
            opacity: 0.8;
          }
        }
        
        .neon-bg-enhancer {
          background: radial-gradient(circle at center, transparent 0%, transparent 40%, ${glowColor + '10'} 70%, ${glowColor + '25'} 100%), 
                      linear-gradient(45deg, transparent 0%, ${glowColor + '08'} 50%, transparent 100%);
          background-size: 200% 200%;
          animation: bgGlow 15s ease infinite;
        }
      `;
      document.head.appendChild(styleEl);
      
      return () => {
        document.head.removeChild(styleEl);
      };
    }
  }, [isNeonTheme, item.category, item.topic]);
  
  const questionState = useAppSelector(state => 
    state.trivia.questions[item.id] as QuestionState | undefined
  );
  
  const dispatch = useAppDispatch();
  
  const { 
    animateIn, 
    animateOut, 
    resetAnimations, 
    getPopupAnimatedStyle,
    springAnimation,
    isIOS
  } = useIOSAnimations();

  const calculateFontSize = useMemo(() => {
    const textLength = item.question.length;
    const lineBreaks = (item.question.match(/\n/g) || []).length;
    
    const isMobileWeb = Platform.OS === 'web' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    let fontSize = isMobileWeb ? 24 : 38;
    
    if (textLength > 50 || lineBreaks > 1) {
      fontSize = isMobileWeb ? 20 : 32;
    }
    
    if (textLength > 100 || lineBreaks > 2) {
      fontSize = isMobileWeb ? 18 : 24;
    }
    
    if (textLength > 130 || lineBreaks > 3) {
      fontSize = isMobileWeb ? 16 : 20;
    }
    
    if (textLength > 180 || lineBreaks > 4) {
      fontSize = isMobileWeb ? 14 : 18;
    }
    
    if (textLength > 200 || lineBreaks > 6) {
      fontSize = 14;
    }
    
    return fontSize;
  }, [item.question]);
  
  const lineHeight = useMemo(() => {
    return Math.round(calculateFontSize * 1.2);
  }, [calculateFontSize]);
  
  useEffect(() => {
    console.log(`[DEBUG] FeedItem component render #${renderCount.current} for item ${item.id}`);
    console.log(`[DEBUG] Current state - hoveredAnswerIndex: ${hoveredAnswerIndex}, hoveredAction: ${hoveredAction}`);
  });
  
  const textColor = useThemeColor({}, 'text');

  // Add sound references with any type to avoid TS errors
  const correctSoundRef = useRef<any>(null);
  const incorrectSoundRef = useRef<any>(null);
  
  // Load sound effects
  useEffect(() => {
    if (isNeonTheme && ExpoAudio.Sound) {
      const loadSounds = async () => {
        try {
          // Try to load the correct answer sound
          try {
            const { sound: correctSound } = await ExpoAudio.Sound.createAsync(
              require('../../../assets/sounds/correct-answer.mp3'),
              { volume: 0.7 }
            );
            correctSoundRef.current = correctSound;
          } catch (soundError) {
            console.log('Failed to load correct sound:', soundError);
          }
          
          // Try to load the incorrect answer sound
          try {
            const { sound: incorrectSound } = await ExpoAudio.Sound.createAsync(
              require('../../../assets/sounds/incorrect-answer.mp3'),
              { volume: 0.7 }
            );
            incorrectSoundRef.current = incorrectSound;
          } catch (soundError) {
            console.log('Failed to load incorrect sound:', soundError);
          }
        } catch (error) {
          console.log('Failed to load sounds:', error);
        }
      };
      
      loadSounds();
      
      // Unload sounds on cleanup
      return () => {
        if (correctSoundRef.current) {
          correctSoundRef.current.unloadAsync();
        }
        if (incorrectSoundRef.current) {
          incorrectSoundRef.current.unloadAsync();
        }
      };
    }
  }, [isNeonTheme]);

  // Add animated values for selection transitions
  const answerScaleAnim = useRef(new Animated.Value(1)).current;
  const answerOpacityAnim = useRef(new Animated.Value(0)).current;
  const [animatingAnswerIndex, setAnimatingAnswerIndex] = useState<number | null>(null);

  // Add smooth selection animation
  const animateAnswerSelection = (index: number, isCorrect: boolean) => {
    // Set which answer is being animated
    setAnimatingAnswerIndex(index);
    
    // Reset animation values
    answerScaleAnim.setValue(1);
    answerOpacityAnim.setValue(0);
    
    // Create animation sequence
    Animated.sequence([
      // Quick subtle scale up
      Animated.timing(answerScaleAnim, {
        toValue: 1.03,
        duration: 150,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      // Scale back down
      Animated.timing(answerScaleAnim, {
        toValue: 1,
        duration: 200,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      })
    ]).start();
    
    // Fade in glow/highlight effect
    Animated.timing(answerOpacityAnim, {
      toValue: 1,
      duration: 400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      // Animation complete, clear animated index
      setAnimatingAnswerIndex(null);
    });
  };

  // Add animations for button press states
  const answerPressAnimations = useRef<Animated.Value[]>([]).current;
  const answerScaleAnimations = useRef<Animated.Value[]>([]).current;
  
  // Initialize animations for each answer
  useEffect(() => {
    // Reset animations when item changes
    answerPressAnimations.length = 0;
    answerScaleAnimations.length = 0;
    
    // Create animation values for each answer
    if (item?.answers) {
      item.answers.forEach((_, index) => {
        answerPressAnimations.push(new Animated.Value(0));
        answerScaleAnimations.push(new Animated.Value(1));
      });
    }
  }, [item?.id]);
  
  // Handle button press states with animations and haptics
  const handlePressIn = (index: number) => {
    if (isAnswered() || !answerPressAnimations[index]) return;
    
    // Visual feedback
    Animated.parallel([
      Animated.timing(answerPressAnimations[index], {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
        easing: Easing.inOut(Easing.quad),
      }),
      Animated.timing(answerScaleAnimations[index], {
        toValue: 0.98,
        duration: 100,
        useNativeDriver: true,
        easing: Easing.inOut(Easing.quad),
      })
    ]).start();
    
    // Stronger haptic feedback on press - use medium impact for better feel
    if (isIOS) {
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch (error) {
        console.log('Error triggering haptic feedback:', error);
      }
    }
  };
  
  const handlePressOut = (index: number) => {
    if (isAnswered() || !answerPressAnimations[index] || !answerScaleAnimations[index]) return;
    
    // Return to normal state with spring animation for natural feel
    Animated.parallel([
      Animated.spring(answerPressAnimations[index], {
        toValue: 0,
        friction: 4,
        tension: 40,
        useNativeDriver: true,
      }),
      Animated.spring(answerScaleAnimations[index], {
        toValue: 1,
        friction: 4,
        tension: 40,
        useNativeDriver: true,
      })
    ]).start();

    // Light haptic feedback on release for complete tactile experience
    if (isIOS) {
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch (error) {
        console.log('Error triggering haptic feedback:', error);
      }
    }
  };
  
  const selectAnswer = (index: number) => {
    if (isIOS) {
      springAnimation();
    }
    
    if (onAnswer && !isAnswered()) {
      // Add selection animation
      animateAnswerSelection(index, item.answers[index].isCorrect);
      
      // Play appropriate sound effect in neon theme
      if (isNeonTheme) {
        try {
          if (item.answers[index].isCorrect && correctSoundRef.current) {
            correctSoundRef.current.replayAsync();
          } else if (!item.answers[index].isCorrect && incorrectSoundRef.current) {
            incorrectSoundRef.current.replayAsync();
          }
        } catch (error) {
          console.log('Error playing sound:', error);
        }
      }
      
      // Enhanced haptic feedback for answer selection with double-pattern for more noticeable feedback
      if (isIOS) {
        try {
          if (item.answers[index].isCorrect) {
            // Immediate medium impact for instant feedback
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            
            // Success notification after a short delay for a two-stage feedback
            setTimeout(() => {
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success
              );
            }, 150);
          } else {
            // Immediate heavy impact for wrong answers
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            
            // Error notification after a short delay
            setTimeout(() => {
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Error
              );
            }, 150);
          }
        } catch (error) {
          console.log('Error triggering haptic feedback:', error);
        }
      }
      
      onAnswer(index, item.answers[index].isCorrect);
      
      if (!item.answers[index].isCorrect) {
        setShowLearningCapsule(true);
        setTimeout(() => {
          animateIn();
        }, 10);
      }
    }
  };

  const toggleLike = () => {
    if (isIOS) {
      springAnimation();
    }
    
    setIsLiked(!isLiked);
  };

  const toggleLearningCapsule = () => {
    if (showLearningCapsule) {
      animateOut(() => {
        setShowLearningCapsule(false);
        resetAnimations();
      });
    } else {
      setShowLearningCapsule(true);
      setTimeout(() => {
        animateIn();
      }, 10);
    }
  };

  const toggleLeaderboard = useCallback(() => {
    if (onToggleLeaderboard) {
      onToggleLeaderboard();
    }
  }, [onToggleLeaderboard]);

  const isAnswered = () => {
    return questionState?.status === 'answered' && questionState?.answerIndex !== undefined;
  };
  
  const isSkipped = () => {
    return questionState?.status === 'skipped';
  };

  const isSelectedAnswerCorrect = () => {
    if (!isAnswered() || questionState?.answerIndex === undefined) {
      return false;
    }
    return item.answers[questionState.answerIndex].isCorrect;
  };

  const handleMouseEnter = (index: number) => {
    if (mouseEnterTimerRef.current) {
      clearTimeout(mouseEnterTimerRef.current);
    }
    mouseEnterTimerRef.current = setTimeout(() => {
      setHoveredAnswerIndex(index);
    }, 30);
  };

  const handleMouseLeave = () => {
    if (mouseLeaveTimerRef.current) {
      clearTimeout(mouseLeaveTimerRef.current);
    }
    mouseLeaveTimerRef.current = setTimeout(() => {
      setHoveredAnswerIndex(null);
    }, 30);
  };

  const handleActionMouseEnter = (action: string) => {
    setHoveredAction(action);
  };

  const handleActionMouseLeave = () => {
    setHoveredAction(null);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Use standard background if not in neon theme */}
        {!isNeonTheme ? (
          <View style={[styles.background, { backgroundColor: item.backgroundColor }]} />
        ) : (
          // Use neon gradient when in neon theme
          <View style={styles.background}>
            <View style={styles.darkBackground} />
            <NeonGradientBackground category={item.category} />
            {/* Add neon glow enhancement layer */}
            <View 
              style={styles.neonGlowEnhancer}
              // Add the class for web-specific styling
              {...(Platform.OS === 'web' ? { className: 'neon-bg-enhancer' } : {})}
            />
            {/* Add an extra dark overlay for increased darkness - but with less opacity */}
            <View style={styles.extraDarkOverlay} />
          </View>
        )}
        
        <View style={[styles.overlay, {zIndex: 1}]} />

        <View style={[styles.content, {zIndex: 2}]}>
          <View style={styles.header}>
            {isNeonTheme ? (
              Platform.OS === 'ios' ? (
                // Enhanced iOS-specific rendering with layered text for better glow
                <View style={{ position: 'relative' }}>
                  {/* Background glow layer - larger blur, lower opacity */}
                  <Text 
                    style={[
                      styles.category,
                      { 
                        position: 'absolute',
                        color: getCategoryColor(item.topic || item.category || 'default').hex || NeonColors.dark.primary,
                        opacity: 0.1,
                        top: 0,
                        left: 0,
                        letterSpacing: 1.2,
                      }
                    ]}
                  >
                    {item.topic || item.category || 'General'}
                  </Text>
                  
                  {/* Middle glow layer - medium blur */}
                  <Text 
                    style={[
                      styles.category, 
                      { 
                        position: 'absolute',
                        color: getCategoryColor(item.topic || item.category || 'default').hex || NeonColors.dark.primary,
                        opacity: 0.2,
                        top: 0,
                        left: 0,
                        letterSpacing: 1.2,
                      }
                    ]}
                  >
                    {item.topic || item.category || 'General'}
                  </Text>
                  
                  {/* Main text layer - sharper, full opacity */}
                  <Text 
                    style={[
                      styles.category, 
                      { 
                        color: getCategoryColor(item.topic || item.category || 'default').hex || NeonColors.dark.primary,
                        letterSpacing: 1.2,
                      }
                    ]}
                  >
                    {item.topic || item.category || 'General'}
                  </Text>
                </View>
              ) : (
                <Text 
                  style={[
                    styles.category, 
                    styles.neonCategoryText, 
                    { 
                      color: getCategoryColor(item.topic || item.category || 'default').hex || NeonColors.dark.primary,
                      letterSpacing: 1.2,
                    }
                  ]}
                >
                  {item.topic || item.category || 'General'}
                </Text>
              )
            ) : (
              <Text style={styles.topicLabel}>{item.topic || item.category || 'General'}</Text>
            )}
            <View style={[styles.difficulty, { 
              backgroundColor: 
                item.difficulty?.toLowerCase() === 'easy' ? '#8BC34A' :
                item.difficulty?.toLowerCase() === 'medium' ? '#FFEB3B' :
                '#9C27B0'
            }]}>
              <Text style={[styles.difficultyText, { 
                color: 
                  item.difficulty?.toLowerCase() === 'easy' ? '#507523' :
                  item.difficulty?.toLowerCase() === 'medium' ? '#806F00' :
                  '#4A1158'
              }]}>{item.difficulty}</Text>
            </View>
          </View>

          <View style={styles.questionContainer}>
            <ThemedText type="question" style={[styles.questionText, { 
              fontSize: calculateFontSize,
              lineHeight: lineHeight 
            }]}>
              {item.question}
            </ThemedText>

            {isSkipped() && (
              <View style={styles.skippedContainer}>
                <FeatherIcon name="skip-forward" size={24} color="#FFC107" style={styles.skippedIcon} />
                <ThemedText style={styles.skippedText}>
                  You skipped this question
                </ThemedText>
              </View>
            )}
            
            <View style={styles.answersContainer}>
              <>
                {item.answers.map((answer, index) => {
                  // Define answer option styles with neon theme support
                  const answerStyle = [
                    styles.answerOption,
                    { backgroundColor: colorScheme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.2)' },
                    // Apply neon style when in neon theme
                    isNeonTheme && (Platform.OS === 'ios' ? styles.neonAnswerOptionIOS : styles.neonAnswerOption),
                    // Apply standard or neon selected styles depending on theme - but not on web
                    isAnswered() && questionState?.answerIndex === index && 
                      (isNeonTheme ? {} : (Platform.OS !== 'web' ? styles.selectedAnswerOption : {})),
                    // Apply standard or neon correct styles depending on theme
                    isAnswered() && 
                    questionState?.answerIndex === index && 
                    answer.isCorrect && 
                      (isNeonTheme ? 
                        (Platform.OS === 'ios' ? styles.neonCorrectAnswerOptionIOS : styles.neonCorrectAnswerOption) : 
                        styles.correctAnswerOption),
                    // Apply standard or neon incorrect styles depending on theme
                    isAnswered() && 
                    questionState?.answerIndex === index && 
                    !answer.isCorrect && 
                      (isNeonTheme ? 
                        (Platform.OS === 'ios' ? styles.neonIncorrectAnswerOptionIOS : styles.neonIncorrectAnswerOption) : 
                        styles.incorrectAnswerOption),
                    // Apply correct style for non-selected correct answer when incorrect answer was chosen
                    isAnswered() && 
                    questionState?.answerIndex !== index && 
                    answer.isCorrect && 
                    !isSelectedAnswerCorrect() && 
                      (isNeonTheme ? 
                        (Platform.OS === 'ios' ? styles.neonCorrectAnswerOptionIOS : styles.neonCorrectAnswerOption) : 
                        styles.correctAnswerOption),
                    // Apply inactive style for non-selected, non-correct answers
                    isAnswered() && 
                    questionState?.answerIndex !== index && 
                    !answer.isCorrect && 
                    !(questionState?.answerIndex !== undefined && !item.answers[questionState.answerIndex].isCorrect && answer.isCorrect) && 
                    styles.inactiveAnswerOption,
                    Platform.OS === 'web' && hoveredAnswerIndex === index && styles.hoveredAnswerOption,
                    isSkipped() && styles.skippedAnswerOption,
                  ];

                  return (
                    <Animated.View 
                      key={`${item.id}-answer-container-${index}`}
                      style={{
                        transform: [
                          { scale: animatingAnswerIndex === index ? 
                            answerScaleAnim : 
                            (isIOS && answerScaleAnimations[index]) ? answerScaleAnimations[index] : 1 
                          }
                        ],
                        marginBottom: 12,
                      }}
                    >
                      {isIOS ? (
                        <Pressable
                          key={`${item.id}-answer-${index}`}
                          style={({pressed}) => [
                            answerStyle, 
                            styles.touchableContainer,
                            !isAnswered() && styles.iosPressableContainer,
                          ]}
                          onPress={() => selectAnswer(index)}
                          onPressIn={() => handlePressIn(index)}
                          onPressOut={() => handlePressOut(index)}
                          disabled={isAnswered()}
                        >
                          {({pressed}) => (
                            <>
                              {isNeonTheme && isIOS && !isAnswered() && (
                                <BlurView 
                                  intensity={35}
                                  tint="dark"
                                  style={StyleSheet.absoluteFill}
                                />
                              )}
                              
                              {/* Dynamic press effect overlay */}
                              {isIOS && !isAnswered() && answerPressAnimations[index] && (
                                <Animated.View 
                                  style={[
                                    StyleSheet.absoluteFill,
                                    styles.pressOverlay,
                                    { 
                                      opacity: answerPressAnimations[index],
                                      backgroundColor: isNeonTheme ? 
                                        `${NeonColors.dark.primary}30` : 
                                        'rgba(255, 255, 255, 0.15)'
                                    }
                                  ]}
                                />
                              )}
                              
                              {/* Add overlay for fade-in effect */}
                              {animatingAnswerIndex === index && (
                                <Animated.View 
                                  style={[
                                    StyleSheet.absoluteFill, 
                                    styles.selectionOverlay,
                                    { 
                                      opacity: answerOpacityAnim,
                                      backgroundColor: answer.isCorrect 
                                        ? 'rgba(0, 255, 0, 0.1)' 
                                        : 'rgba(255, 0, 0, 0.1)' 
                                    }
                                  ]} 
                                />
                              )}
                              
                              <ThemedText 
                                type="default"
                                style={[
                                  styles.answerText, 
                                  isAnswered() && questionState?.answerIndex === index && 
                                    (isNeonTheme ? 
                                      (answer.isCorrect ? styles.neonCorrectAnswerText : styles.neonIncorrectAnswerText) :
                                      styles.selectedAnswerText),
                                  isAnswered() && questionState?.answerIndex !== index && 
                                    answer.isCorrect && !isSelectedAnswerCorrect() && 
                                    (isNeonTheme ? styles.neonCorrectAnswerText : {}),
                                  isSkipped() && styles.skippedAnswerText
                                ]}
                              >
                                {answer.text}
                              </ThemedText>
                              
                              {(isAnswered() && questionState?.answerIndex === index && (
                                answer.isCorrect ? 
                                <FeatherIcon name="check-square" size={24} color={isNeonTheme ? "#00FF00" : "#4CAF50"} style={{marginLeft: 8} as TextStyle} /> : 
                                <FeatherIcon name="x-circle" size={24} color={isNeonTheme ? "#FF0000" : "#F44336"} style={{marginLeft: 8} as TextStyle} />
                              )) || (isAnswered() && !isSelectedAnswerCorrect() && answer.isCorrect && (
                                <FeatherIcon name="square" size={24} color={isNeonTheme ? "#00FF00" : "#4CAF50"} style={{marginLeft: 8} as TextStyle} />
                              ))}
                            </>
                          )}
                        </Pressable>
                      ) : (
                        <TouchableOpacity
                          key={`${item.id}-answer-${index}`}
                          style={[answerStyle, styles.touchableContainer]}
                          onPress={() => selectAnswer(index)}
                          disabled={isAnswered()}
                          {...(Platform.OS === 'web' ? {
                            onMouseEnter: () => handleMouseEnter(index),
                            onMouseLeave: handleMouseLeave
                          } : {})}
                        >
                          {isNeonTheme && isIOS && !isAnswered() && (
                            <BlurView 
                              intensity={35}
                              tint="dark"
                              style={StyleSheet.absoluteFill}
                            />
                          )}
                          
                          {/* Add overlay for fade-in effect */}
                          {animatingAnswerIndex === index && (
                            <Animated.View 
                              style={[
                                StyleSheet.absoluteFill, 
                                styles.selectionOverlay,
                                { 
                                  opacity: answerOpacityAnim,
                                  backgroundColor: answer.isCorrect 
                                    ? 'rgba(0, 255, 0, 0.1)' 
                                    : 'rgba(255, 0, 0, 0.1)' 
                                }
                              ]} 
                            />
                          )}
                          
                          <ThemedText 
                            type="default"
                            style={[
                              styles.answerText, 
                              isAnswered() && questionState?.answerIndex === index && 
                                (isNeonTheme ? 
                                  (answer.isCorrect ? styles.neonCorrectAnswerText : styles.neonIncorrectAnswerText) :
                                  styles.selectedAnswerText),
                              isAnswered() && questionState?.answerIndex !== index && 
                                answer.isCorrect && !isSelectedAnswerCorrect() && 
                                (isNeonTheme ? styles.neonCorrectAnswerText : {}),
                              isSkipped() && styles.skippedAnswerText
                            ]}
                          >
                            {answer.text}
                          </ThemedText>
                          
                          {(isAnswered() && questionState?.answerIndex === index && (
                            answer.isCorrect ? 
                            <FeatherIcon name="check-square" size={24} color={isNeonTheme ? "#00FF00" : "#4CAF50"} style={{marginLeft: 8} as TextStyle} /> : 
                            <FeatherIcon name="x-circle" size={24} color={isNeonTheme ? "#FF0000" : "#F44336"} style={{marginLeft: 8} as TextStyle} />
                          )) || (isAnswered() && !isSelectedAnswerCorrect() && answer.isCorrect && (
                            <FeatherIcon name="square" size={24} color={isNeonTheme ? "#00FF00" : "#4CAF50"} style={{marginLeft: 8} as TextStyle} />
                          ))}
                        </TouchableOpacity>
                      )}
                    </Animated.View>
                  );
                })}
                
                {isAnswered() && (
                  <>
                  </>
                )}
              </>
            </View>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity 
              onPress={toggleLike} 
              style={[
                styles.actionButton,
                Platform.OS === 'web' && hoveredAction === 'like' && styles.hoveredActionButton
              ]}
              {...(Platform.OS === 'web' ? {
                onMouseEnter: () => handleActionMouseEnter('like'),
                onMouseLeave: handleActionMouseLeave
              } : {})}
            >
              <FeatherIcon 
                name={isLiked ? "heart" : "heart"} 
                size={20} 
                color={isLiked ? '#F44336' : 'white'} 
                style={[styles.icon, isLiked ? {} : {opacity: 0.8}]} 
              />
              <ThemedText style={styles.actionText}>
                {isLiked ? item.likes + 1 : item.likes}
              </ThemedText>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={toggleLeaderboard}
              style={[
                styles.actionButton,
                Platform.OS === 'web' && hoveredAction === 'leaderboard' && styles.hoveredActionButton
              ]}
              {...(Platform.OS === 'web' ? {
                onMouseEnter: () => handleActionMouseEnter('leaderboard'),
                onMouseLeave: handleActionMouseLeave
              } : {})}
            >
              <FeatherIcon 
                name="award" 
                size={20} 
                color="white" 
                style={styles.icon} 
              />
              <ThemedText style={styles.actionText}>Leaderboard</ThemedText>
            </TouchableOpacity>
          </View>
        </View>

        {showLearningCapsule && (
          <Animated.View style={[
            styles.learningCapsule, 
            isNeonTheme && styles.neonLearningCapsule,
            getPopupAnimatedStyle()
          ]}>
            <View style={[
              styles.learningCapsuleHeader,
              isNeonTheme && styles.neonLearningCapsuleHeader
            ]}>
              <ThemedText style={[
                styles.learningCapsuleTitle,
                isNeonTheme && styles.neonLearningCapsuleTitle
              ]}>
                Learn More
              </ThemedText>
              <TouchableOpacity 
                onPress={toggleLearningCapsule} 
                style={[styles.closeButton, isNeonTheme && styles.neonCloseButton]}
              >
                <FeatherIcon 
                  name="x" 
                  size={24} 
                  color={isNeonTheme ? NeonColors.dark.primary : "white"} 
                />
              </TouchableOpacity>
            </View>
            <ThemedText style={[
              styles.learningCapsuleText,
              isNeonTheme && styles.neonLearningCapsuleText
            ]}>
              {item.learningCapsule}
            </ThemedText>
          </Animated.View>
        )}
      </View>
    </SafeAreaView>
  );
};

export default FeedItem;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  container: {
    width: '100%',
    height: '100%',
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    flexDirection: 'column',
    justifyContent: 'flex-end',
  },
  background: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  darkBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#050508', // Even darker blue-black
  },
  neonGlowEnhancer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    zIndex: 1,
    // For mobile, we'll use a shadow effect
    ...(Platform.OS !== 'web' ? {
      shadowColor: NeonColors.dark.primary,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.4, // Increased from 0.3
      shadowRadius: 40, // Increased from 30
    } : {}),
  },
  extraDarkOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.25)', // Further reduced opacity from 0.3 to 0.25
    zIndex: 2,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.35)', // Increased darkness in overlay
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
    paddingTop: 20,
    ...(Platform.OS === 'web' ? {
      maxWidth: 600,
      alignSelf: 'center',
      width: '100%',
    } : {})
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  topicLabel: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  neonCategoryText: {
    fontWeight: 'bold',
    fontSize: 18, // Slightly larger
    ...(Platform.OS === 'web' ? {
      animation: 'categoryNeonGlow 2s infinite alternate',
      textShadow: 'none'
    } as any : Platform.OS === 'ios' ? {
      // Enhanced iOS-specific styling for more gentle, realistic neon glow
      // iOS handles text shadows differently, so we need to be more subtle
      opacity: 0.95, // Slight transparency for better glow effect
      // We'll use the component to create multiple text instances for layered glow
    } : {
      // Android and other platforms
    }),
  },
  difficulty: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  difficultyText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  questionContainer: {
    marginBottom: 20,
  },
  questionText: {
    color: 'white',
    fontWeight: 'bold',
    marginBottom: 20,
  },
  answersContainer: {
    marginTop: 10,
  },
  answerOption: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.5,
    elevation: 2,
    ...(Platform.OS === 'web' ? {
      transition: 'all 0.25s cubic-bezier(0.2, 0, 0.15, 1)',
      backgroundColor: 'rgba(15, 15, 25, 0.8)', // Darker background
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      transform: 'scale(1)',
    } as any : {})
  },
  selectedAnswerOption: {
    borderWidth: 2,
    borderColor: '#ffffff',
    backgroundColor: 'rgba(60, 60, 80, 0.85)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: Platform.OS === 'android' ? 4 : 0,
    ...(Platform.OS === 'web' ? {
      backgroundColor: 'rgba(60, 60, 80, 0.85)',
      transform: [{scale: 1.02}],
      transition: 'all 0.2s ease',
    } as any : {}),
  },
  correctAnswerOption: {
    backgroundColor: 'rgba(0, 100, 0, 0.7)',
    borderWidth: 2,
    borderColor: '#4CAF50',
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: Platform.OS === 'android' ? 4 : 0,
    ...(Platform.OS === 'web' ? {
      backgroundColor: 'rgba(0, 100, 0, 0.7)',
      transform: [{scale: 1.02}],
      transition: 'all 0.2s ease',
    } as any : {}),
  },
  incorrectAnswerOption: {
    backgroundColor: 'rgba(100, 0, 0, 0.7)',
    borderWidth: 2,
    borderColor: '#F44336',
    shadowColor: '#F44336',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: Platform.OS === 'android' ? 4 : 0,
    ...(Platform.OS === 'web' ? {
      backgroundColor: 'rgba(100, 0, 0, 0.7)',
      transform: [{scale: 1.02}],
      transition: 'all 0.2s ease',
    } as any : {}),
  },
  hoveredAnswerOption: {
    backgroundColor: 'rgba(20, 20, 30, 0.85)', // Even darker when hovering
    transform: [{scale: 1.01}],
    ...(Platform.OS === 'web' ? {
      transition: 'all 0.2s ease',
      boxShadow: `0 0 8px ${NeonColors.dark.primary}, 0 0 4px ${NeonColors.dark.primary}`, // Added neon glow effect on hover
    } as any : {}),
  },
  skippedAnswerOption: {
    opacity: 0.7,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  answerText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  selectedAnswerText: {
    fontWeight: 'bold',
  },
  skippedAnswerText: {
    opacity: 0.7,
  },
  skippedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255, 193, 7, 0.2)',
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 193, 7, 0.5)',
  },
  skippedIcon: {
    marginRight: 8,
  },
  skippedText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginTop: 20,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 20,
  },
  hoveredActionButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  icon: {
    marginRight: 5,
  },
  actionText: {
    color: 'white',
    fontSize: 14,
  },
  learningCapsule: {
    position: 'absolute',
    top: 100,
    alignSelf: 'center',
    width: '90%',
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    maxHeight: '40%',
    zIndex: 1000,
    ...(Platform.OS === 'web' ? {
      maxWidth: 600,
      width: '80%',
    } : {})
  },
  learningCapsuleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  learningCapsuleTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 5,
  },
  learningCapsuleText: {
    color: 'white',
    fontSize: 16,
    lineHeight: 20,
  },
  disabledActionButton: {
    opacity: 0.5,
  },
  disabledIcon: {
    opacity: 0.5,
  },
  disabledText: {
    opacity: 0.5,
  },
  neonAnswerOption: {
    backgroundColor: 'rgba(10, 10, 20, 0.6)', // Darker background
    borderWidth: 1,
    borderColor: NeonColors.dark.primary,
    shadowColor: NeonColors.dark.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7, // Increased from 0.5
    shadowRadius: 6, // Increased from 4
    elevation: Platform.OS === 'android' ? 4 : 0, // Increased from 3
    ...(Platform.OS === 'web' ? {
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      backgroundColor: 'rgba(10, 10, 20, 0.75)',
      transition: 'all 0.25s cubic-bezier(0.2, 0, 0.15, 1)',
      // Removed boxShadow for default state
    } as any : {}),
  },
  neonAnswerOptionIOS: {
    backgroundColor: 'rgba(10, 10, 20, 0.6)', // Darker background
    borderWidth: 1,
    borderColor: NeonColors.dark.primary,
    shadowColor: NeonColors.dark.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 3,
    overflow: 'hidden',
  },
  neonCorrectAnswerOption: {
    backgroundColor: 'rgba(0, 50, 0, 0.6)',
    borderWidth: 2,
    borderColor: '#00FF00',
    shadowColor: '#00FF00',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8, // Increased from 0.6
    shadowRadius: 8, // Increased from 6
    elevation: Platform.OS === 'android' ? 5 : 0,
    ...(Platform.OS === 'web' ? {
      animation: 'neonPulse 2.5s infinite alternate',
      backgroundColor: 'rgba(0, 30, 0, 0.8)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
    } as any : {}),
  },
  neonIncorrectAnswerOption: {
    backgroundColor: 'rgba(50, 0, 0, 0.6)',
    borderWidth: 2,
    borderColor: '#FF0000',
    shadowColor: '#FF0000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8, // Increased from 0.6
    shadowRadius: 8, // Increased from 6
    elevation: Platform.OS === 'android' ? 5 : 0,
    ...(Platform.OS === 'web' ? {
      animation: 'neonPulse 2.5s infinite alternate',
      backgroundColor: 'rgba(30, 0, 0, 0.8)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
    } as any : {}),
  },
  neonCorrectAnswerOptionIOS: {
    backgroundColor: 'rgba(0, 40, 0, 0.7)', // Darker green for iOS
    borderWidth: 2.5,
    borderColor: '#00FF00',
    shadowColor: '#00FF00',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    overflow: 'hidden',
  },
  neonIncorrectAnswerOptionIOS: {
    backgroundColor: 'rgba(40, 0, 0, 0.7)', // Darker red for iOS
    borderWidth: 2.5,
    borderColor: '#FF0000',
    shadowColor: '#FF0000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    overflow: 'hidden',
  },
  // Add style for animated text in neon theme
  neonSelectedAnswerText: {
    fontWeight: 'bold',
    color: '#FFFFFF',
    ...(Platform.OS === 'web' ? {
      animation: 'neonTextGlow 2s infinite alternate',
      textShadow: 'none'
    } as any : {}),
  },
  neonCorrectAnswerText: {
    fontWeight: 'bold',
    color: '#00FF00',
    ...(Platform.OS === 'web' ? {
      animation: 'neonTextGlow 2s infinite alternate',
      textShadow: 'none'
    } as any : {}),
  },
  neonIncorrectAnswerText: {
    fontWeight: 'bold',
    color: '#FF0000',
    ...(Platform.OS === 'web' ? {
      animation: 'neonTextGlow 2s infinite alternate',
      textShadow: 'none'
    } as any : {}),
  },
  touchableContainer: {
    position: 'relative',
    overflow: 'hidden',
  },
  selectionOverlay: {
    borderRadius: 12,
    ...(Platform.OS === 'web' ? {
      transition: 'opacity 0.3s ease-out'
    } as any : {})
  },
  // Add neon theme styles for learning capsule
  neonLearningCapsule: {
    backgroundColor: 'rgba(5, 5, 10, 0.9)', // Much darker background
    borderColor: NeonColors.dark.primary,
    borderWidth: 2,
    shadowColor: NeonColors.dark.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    ...(Platform.OS === 'web' ? {
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      boxShadow: `0 0 15px ${NeonColors.dark.primary}, 0 0 5px ${NeonColors.dark.primary}`,
    } as any : {}),
  },
  neonLearningCapsuleHeader: {
    borderBottomWidth: 1,
    borderBottomColor: `${NeonColors.dark.primary}80`, // 50% opacity
    paddingBottom: 10,
    marginBottom: 15,
  },
  neonLearningCapsuleTitle: {
    color: NeonColors.dark.primary,
  },
  neonCloseButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  neonLearningCapsuleText: {
    color: '#ffffff',
    lineHeight: 22,
  },
  iosPressableContainer: {
    overflow: 'hidden',
    transform: [{perspective: 1000}],
  },
  pressOverlay: {
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.15)'
  },
  categoryTag: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 5,
    marginRight: 5,
    marginBottom: 5,
  },
  categoryText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: 'bold',
  },
  inactiveAnswerOption: {
    opacity: 0.5,  // Make the inactive answers half-transparent
  },
});