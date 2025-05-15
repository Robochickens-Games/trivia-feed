import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, FlatList, Image, ActivityIndicator, useWindowDimensions, Platform, Text } from 'react-native';
import { fetchLeaderboard, LeaderboardUser, LeaderboardPeriod, fetchUserRank } from '../lib/leaderboardService';
import { useAuth } from '../context/AuthContext';
import { countries } from '../data/countries';
import { ThemedView } from '../../components/ThemedView';
import { ThemedText } from '../../components/ThemedText';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Colors } from '@/constants/Colors';
import { FeatherIcon } from '@/components/FeatherIcon';
import { WebContainer } from '@/components/WebContainer';
import { colors, spacing, borderRadius } from '@/src/theme';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Button from './ui/Button';
import { useTheme } from '@/src/context/ThemeContext';

const LeaderboardTabs = {
  Daily: 'day',
  Weekly: 'week',
  Monthly: 'month',
  AllTime: 'all'
} as const;

type LeaderboardTabKey = keyof typeof LeaderboardTabs;

interface LeaderboardProps {
  limit?: number;
  disableScrolling?: boolean;
}

export default function Leaderboard({ limit = 10, disableScrolling = false }: LeaderboardProps) {
  const [activeTab, setActiveTab] = useState<LeaderboardTabKey>('Daily');
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [userRank, setUserRank] = useState<number | null>(null);
  const { user, isGuest } = useAuth();
  const colorScheme = useColorScheme() ?? 'dark';
  const isDark = colorScheme === 'dark';
  const { width } = useWindowDimensions();
  const isTablet = width > 768;
  const { currentTheme, themeDefinition } = useTheme();

  // Get theme colors
  const getThemeColor = (colorName: string = 'primary') => {
    // For neon theme, override primary color to yellow
    if (currentTheme === 'neon' && colorName === 'primary') {
      return '#FFFF00'; // Bright yellow for neon theme
    }
    
    if (themeDefinition && themeDefinition.colors && themeDefinition.colors[isDark ? 'dark' : 'light']) {
      // Get the color palette for current theme and color scheme
      const colorPalette = themeDefinition.colors[isDark ? 'dark' : 'light'];
      
      // Map the simplified color names to the theme color palette properties
      const colorMap: Record<string, keyof typeof colorPalette> = {
        primary: 'primary',
        secondary: 'secondary',
        accent: 'accent',
        background: 'background',
        surface: 'surface',
        card: 'card',
        text: 'text',
        border: 'border',
        success: 'success',
        error: 'error',
        warning: 'warning',
        info: 'info',
        icon: 'icon'
      };
      
      // Get the mapped color key or use the direct key
      const colorKey = colorMap[colorName] || colorName as keyof typeof colorPalette;
      
      // Check if the color exists in the palette and return it
      if (colorKey in colorPalette) {
        return colorPalette[colorKey];
      }
      
      // Return fallback colors
      return colorName === 'primary' ? '#ffc107' : 
        colorName === 'error' ? '#e74c3c' : 
        colorName === 'info' ? '#0a7ea4' : 
        '#ffc107';
    }
    
    // Default fallback colors
    return colorName === 'primary' ? '#ffc107' : 
      colorName === 'error' ? '#e74c3c' : 
      colorName === 'info' ? '#0a7ea4' : 
      '#ffc107';
  };

  // Use theme colors instead of hardcoded values
  const ACCENT_COLOR = getThemeColor('accent');
  const ACCENT_FOREGROUND = isDark ? '#000000' : '#FFFFFF';

  // Add debug log for auth state
  useEffect(() => {
    console.log('Leaderboard - Auth state:', { 
      hasUser: !!user, 
      isGuest, 
      activeTab 
    });
    
    // Check AsyncStorage directly for debugging
    const checkGuestMode = async () => {
      try {
        const guestMode = await AsyncStorage.getItem('guestMode');
        console.log('Leaderboard - Guest mode in AsyncStorage:', guestMode);
      } catch (e) {
        console.error('Error checking guest mode in Leaderboard:', e);
      }
    };
    
    checkGuestMode();
  }, [user, isGuest, activeTab]);

  useEffect(() => {
    loadLeaderboardData();
  }, [activeTab]);

  const loadLeaderboardData = async () => {
    try {
      setIsLoading(true);
      const period = LeaderboardTabs[activeTab] as LeaderboardPeriod;
      const data = await fetchLeaderboard(period, limit);
      setLeaderboardData(data);

      // Get user rank if logged in
      if (user) {
        const rank = await fetchUserRank(user.id, period);
        setUserRank(rank);
      }
    } catch (error) {
      console.error('Error loading leaderboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Convert country code to flag emoji
  const getCountryFlag = (code: string | null): string => {
    if (!code) return '';
    
    // Special case for "Other" country
    if (code === 'OT') {
      return '🌍'; // Earth globe emoji for "Other"
    }
    
    // Country code to regional indicator symbols
    // For example: 'US' becomes 🇺🇸
    const codePoints = [...code.toUpperCase()].map(
      char => 127397 + char.charCodeAt(0)
    );
    
    return String.fromCodePoint(...codePoints);
  };

  // Get initials for avatar
  const getInitials = (name: string = '') => {
    if (name) {
      return name.substring(0, 2).toUpperCase();
    }
    return '?';
  };

  const renderItem = ({ item, index }: { item: LeaderboardUser; index: number }) => {
    // Calculate which column to display based on the active tab
    let scoreToShow: number;
    switch (LeaderboardTabs[activeTab]) {
      case 'day':
        scoreToShow = item.correct_answers_today;
        break;
      case 'week':
        scoreToShow = item.correct_answers_week;
        break;
      case 'month':
        scoreToShow = item.correct_answers_month;
        break;
      case 'all':
      default:
        scoreToShow = item.correct_answers_count;
    }

    // Determine if this is the current user
    const isCurrentUser = user && user.id === item.id;

    // Get theme-specific styles for the item
    const itemBackgroundColor = isCurrentUser 
      ? `${getThemeColor('accent')}20` // 20% opacity accent color
      : index % 2 === 1 
        ? `${getThemeColor('muted')}20` // 20% opacity muted color for alternating rows
        : 'transparent';

    return (
      <ThemedView style={[
        styles.itemContainer, 
        isCurrentUser && [styles.currentUserItem, { backgroundColor: itemBackgroundColor }],
        index % 2 === 1 && !isCurrentUser && [styles.altItemContainer, { backgroundColor: itemBackgroundColor }],
      ]}
      {...(Platform.OS === 'web' ? {
        className: `leaderboard-item ${isCurrentUser ? 'current-user' : ''}`
      } : {})}>
        <ThemedText style={[styles.rank, isCurrentUser && [styles.currentUserRank, { color: getThemeColor('accent') }]]}>
          {index + 1}
        </ThemedText>
        
        <View style={styles.avatarContainer}>
          {item.avatar_url ? (
            // If the user has an avatar image - show it
            <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
          ) : !user ? (
            // If no user is logged in (app user, not leaderboard item) - show the guest avatar
            <Image 
              source={require('../../assets/images/guest-avatar.png')}
              style={styles.avatar}
              resizeMode="cover"
            />
          ) : (
            // If user is logged in but the leaderboard item has no avatar - show initials
            <View style={[
              styles.avatarPlaceholder, 
              isCurrentUser && [
                styles.currentUserAvatar, 
                { backgroundColor: getThemeColor('accent') }
              ]
            ]}>
              <ThemedText style={styles.avatarText}>{getInitials(item.full_name)}</ThemedText>
            </View>
          )}
        </View>
        
        <View style={styles.userInfo}>
          <View style={styles.usernameRow}>
            <ThemedText style={[styles.username, isCurrentUser && styles.currentUserText]}>
              {item.full_name || 'Anonymous'} 
              {isCurrentUser && <ThemedText style={[styles.youLabel, { color: getThemeColor('accent') }]}>(You)</ThemedText>}
            </ThemedText>
            
            {item.country && (
              <Text style={styles.flag}>
                {getCountryFlag(item.country)}
              </Text>
            )}
          </View>
        </View>
        
        <View style={styles.scoreContainer}>
          <ThemedText style={[
            styles.scoreValue, 
            { color: isCurrentUser ? getThemeColor('accent') : isDark ? getThemeColor('accent') : getThemeColor('secondary') }
          ]}>
            {scoreToShow}
          </ThemedText>
          <ThemedText style={styles.scoreLabel}>
            correct
          </ThemedText>
        </View>
      </ThemedView>
    );
  };

  // If scrolling is disabled and we have data, render a plain View with items
  // This prevents nested VirtualizedLists with the same orientation
  const renderLeaderboardContent = () => {
    if (disableScrolling && !isLoading && leaderboardData.length > 0) {
      return (
        <View style={[
          styles.listContent,
          isTablet && { maxWidth: 800, alignSelf: 'center', width: '100%' }
        ]}>
          {leaderboardData.map((item, index) => (
            <View key={item.id}>
              {renderItem({ item, index })}
            </View>
          ))}
        </View>
      );
    }
    
    if (isLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={getThemeColor('primary')} />
        </View>
      );
    }
    
    if (leaderboardData.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <FeatherIcon 
            name="award" 
            size={64} 
            color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.2)'} 
          />
          <ThemedText style={styles.emptyText}>No data available for this period</ThemedText>
        </View>
      );
    }
    
    return (
      <FlatList
        data={leaderboardData}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent, 
          isTablet && { maxWidth: 800, alignSelf: 'center', width: '100%' }
        ]}
      />
    );
  };

  // Render a sign-in prompt banner for guest users
  const renderGuestPrompt = () => {
    // Always check AsyncStorage directly to be doubly sure
    const [localIsGuest, setLocalIsGuest] = useState(isGuest);
    
    useEffect(() => {
      const checkLocalGuestMode = async () => {
        try {
          const guestMode = await AsyncStorage.getItem('guestMode');
          setLocalIsGuest(guestMode === 'true' || isGuest);
        } catch (e) {
          console.error('Error in local guest mode check in Leaderboard:', e);
        }
      };
      
      checkLocalGuestMode();
    }, [isGuest]);
    
    if (!localIsGuest) return null;
    
    // Get theme-specific styling for the guest prompt
    const promptBackgroundColor = currentTheme === 'neon'
      ? 'rgba(255, 255, 0, 0.15)' // Yellow with opacity for neon theme  
      : `${getThemeColor('primary')}15`; // 15% opacity of primary color
    
    const promptBorderColor = getThemeColor('primary');
    
    return (
      <View style={[
        styles.guestPromptContainer,
        { 
          backgroundColor: promptBackgroundColor,
          borderLeftColor: promptBorderColor 
        }
      ]}>
        <Image 
          source={require('../../assets/images/guest-avatar.png')}
          style={{ width: 42, height: 42, borderRadius: 21, marginRight: 12 }}
          resizeMode="cover"
        />
        <View style={{ flex: 1 }}>
          <ThemedText style={[styles.guestPromptTitle, { color: getThemeColor('text') }]}>
            Want to join the leaderboard?
          </ThemedText>
          <ThemedText style={[styles.guestPromptText, { color: getThemeColor('textSecondary') }]}>
            Sign in to track your progress and compete with others!
          </ThemedText>
        </View>
        <Button
          variant="accent"
          size="sm"
          leftIcon={<FeatherIcon name="log-in" size={16} color="#000" />}
          onPress={() => {
            router.push({
              pathname: '/auth/login',
              params: { direct: 'true' }
            });
          }}
        >
          Sign In
        </Button>
      </View>
    );
  };

  const content = (
    <ThemedView 
      style={styles.container}
      {...(Platform.OS === 'web' ? { className: 'leaderboard-container' } : {})}
    >
      <View style={styles.header}>
        <ThemedText type="subtitle" style={styles.headerTitle}>Leaderboard</ThemedText>
      </View>
      
      <View style={styles.tabContainer}>
        {(Object.keys(LeaderboardTabs) as LeaderboardTabKey[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[
              styles.tab, 
              tab === activeTab && [
                styles.activeTab, 
                { borderBottomColor: getThemeColor('accent') }
              ]
            ]}
            onPress={() => setActiveTab(tab)}
          >
            <ThemedText style={[
              styles.tabText, 
              tab === activeTab && [
                styles.activeTabText, 
                { color: getThemeColor('accent') }
              ]
            ]}>
              {tab}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </View>
      
      {user && userRank !== null && (
        <ThemedView style={styles.yourRankContainer}>
          <ThemedText style={styles.yourRankText}>
            Your Rank: <ThemedText style={[styles.rankNumber, { color: getThemeColor('accent') }]}>#{userRank}</ThemedText>
          </ThemedText>
        </ThemedView>
      )}
      
      {renderGuestPrompt()}
      
      {renderLeaderboardContent()}
    </ThemedView>
  );

  // Use WebContainer on web for better responsive design
  if (Platform.OS === 'web') {
    // Ensure dark theme styling for any web-specific elements
    useEffect(() => {
      if (isDark) {
        document.body.classList.add('dark-theme');
        
        // Add inline styles for specific leaderboard elements
        const style = document.createElement('style');
        style.textContent = `
          .leaderboard-container {
            background-color: ${getThemeColor('background')};
            color: ${getThemeColor('text')};
          }
          .leaderboard-item {
            background-color: ${getThemeColor('card')};
            border: 1px solid ${getThemeColor('border')};
          }
          .leaderboard-item.current-user {
            background-color: ${isDark ? `${getThemeColor('accent')}20` : `${getThemeColor('accent')}10`};
            border-color: ${getThemeColor('accent')};
          }
        `;
        document.head.appendChild(style);
        
        return () => {
          document.head.removeChild(style);
        };
      }
      return () => {};
    }, [isDark, currentTheme]);
    
    return <WebContainer>{content}</WebContainer>;
  }

  return content;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingTop: Platform.OS === 'ios' ? 60 : spacing[4],
    display: 'none', // Hide this header since we're using the modal header
  },
  headerTitle: {
    fontSize: 24,
  },
  tabContainer: {
    flexDirection: 'row',
  },
  tab: {
    flex: 1,
    paddingVertical: spacing[3],
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 3,
  },
  tabText: {
    fontSize: 14,
    color: colors.mutedForeground,
    fontWeight: '500',
  },
  activeTabText: {
    fontWeight: '600',
  },
  yourRankContainer: {
    padding: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  yourRankText: {
    fontSize: 16,
    textAlign: 'center',
    fontWeight: '500',
  },
  rankNumber: {
    fontWeight: 'bold',
  },
  listContent: {
    padding: 0,
  },
  itemContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[4],
  },
  altItemContainer: {
    // Background color now set inline
  },
  currentUserItem: {
    // Background color now set inline
  },
  rank: {
    width: 30,
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  currentUserRank: {
    // Color now set inline
  },
  avatarContainer: {
    marginRight: spacing[3],
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.muted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  currentUserAvatar: {
    // Background color now set inline
  },
  avatarText: {
    color: colors.foreground,
    fontSize: 16,
    fontWeight: 'bold',
  },
  userInfo: {
    flex: 1,
  },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  username: {
    fontSize: 16,
    fontWeight: '600',
  },
  currentUserText: {
    fontWeight: '700',
  },
  youLabel: {
    fontStyle: 'italic',
    marginLeft: 4,
  },
  flag: {
    fontSize: 18,
    marginLeft: 8,
  },
  scoreContainer: {
    alignItems: 'flex-end',
    minWidth: 60,
  },
  scoreValue: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  scoreLabel: {
    fontSize: 12,
    color: colors.mutedForeground,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[5],
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[5],
  },
  emptyText: {
    marginTop: spacing[4],
    fontSize: 16,
    opacity: 0.7,
    textAlign: 'center',
  },
  guestPromptContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    marginBottom: 16,
    borderRadius: 8,
    borderLeftWidth: 3,
  },
  guestPromptTitle: {
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 4,
  },
  guestPromptText: {
    fontSize: 14,
    opacity: 0.8,
  },
}); 