/**
 * Design System
 * 
 * A comprehensive, scalable, and sustainable design system that works across platforms.
 * This file contains all design tokens - colors, typography, spacing, shadows, etc.
 * Used for maintaining consistent styling throughout the application.
 */

import { Platform } from 'react-native';

/* -------------------------------------------- */
/* COLORS                                       */
/* -------------------------------------------- */

const palette = {
  // Core brand colors
  primary: {
    50: '#e0f3fa',
    100: '#b3e1f3',
    200: '#80ceeb',
    300: '#4dbae3',
    400: '#26abdd',
    500: '#ffc107', // Main brand color (yellow)
    600: '#09719a',
    700: '#07618e',
    800: '#055182',
    900: '#03356c',
  },
  
  // Neutral colors
  neutral: {
    50: '#fafafa',
    100: '#f5f5f5',
    200: '#e5e5e5',
    300: '#d4d4d4',
    400: '#a3a3a3',
    500: '#737373',
    600: '#525252',
    700: '#404040',
    800: '#262626',
    900: '#171717',
    950: '#09090b',
  },
  
  // Semantic colors - Success
  success: {
    50: '#ecfdf5',
    100: '#d1fae5',
    200: '#a7f3d0',
    300: '#6ee7b7',
    400: '#34d399',
    500: '#10b981',
    600: '#059669',
    700: '#047857',
    800: '#065f46',
    900: '#064e3b',
  },
  
  // Semantic colors - Warning
  warning: {
    50: '#fffbeb',
    100: '#fef3c7',
    200: '#fde68a',
    300: '#fcd34d',
    400: '#fbbf24',
    500: '#f59e0b',
    600: '#d97706',
    700: '#b45309',
    800: '#92400e',
    900: '#78350f',
  },
  
  // Semantic colors - Error
  error: {
    50: '#fef2f2',
    100: '#fee2e2',
    200: '#fecaca',
    300: '#fca5a5',
    400: '#f87171',
    500: '#ef4444',
    600: '#dc2626',
    700: '#b91c1c',
    800: '#991b1b',
    900: '#7f1d1d',
  },
  
  // Semantic colors - Info
  info: {
    50: '#eff6ff',
    100: '#dbeafe',
    200: '#bfdbfe',
    300: '#93c5fd',
    400: '#60a5fa',
    500: '#3b82f6',
    600: '#2563eb',
    700: '#1d4ed8',
    800: '#1e40af',
    900: '#1e3a8a',
  },
  
  // Additional accent colors (can be expanded as needed)
  accent1: {
    500: '#8b5cf6', // Purple
  },
  accent2: {
    500: '#ec4899', // Pink
  },
};

// Theme color schemes
export const colors = {
  light: {
    // Background colors
    background: palette.neutral[50],
    surface: '#ffffff',
    surfaceVariant: palette.neutral[100],
    card: palette.neutral[50],
    
    // Text colors
    text: palette.neutral[900],
    textSecondary: palette.neutral[700],
    textTertiary: palette.neutral[500],
    textInverted: '#000000',
    
    // UI Element colors
    border: palette.neutral[300],
    borderFocus: palette.primary[500],
    divider: palette.neutral[200],
    
    // Interactive element colors
    primary: palette.primary[500],
    primaryDarker: palette.primary[600],
    primaryLighter: palette.primary[400],
    
    // Status colors
    success: palette.success[500],
    warning: palette.warning[500],
    error: palette.error[500],
    info: palette.info[500],
    
    // Component specific colors
    icon: palette.neutral[500],
    shadow: 'rgba(0, 0, 0, 0.1)',
    overlay: 'rgba(0, 0, 0, 0.5)',
    
    // Tab navigation colors
    tabIconDefault: palette.neutral[500],
    tabIconSelected: palette.primary[500],
  },
  
  dark: {
    // Background colors
    background: palette.neutral[950],
    surface: palette.neutral[900],
    surfaceVariant: palette.neutral[800],
    card: palette.neutral[900],
    
    // Text colors
    text: palette.neutral[50],
    textSecondary: palette.neutral[300],
    textTertiary: palette.neutral[400],
    textInverted: '#000000',
    
    // UI Element colors
    border: palette.neutral[700],
    borderFocus: palette.primary[500],
    divider: palette.neutral[800],
    
    // Interactive element colors
    primary: palette.primary[500],
    primaryDarker: palette.primary[600],
    primaryLighter: palette.primary[400],
    
    // Status colors
    success: palette.success[500],
    warning: palette.warning[500],
    error: palette.error[500],
    info: palette.info[500],
    
    // Component specific colors
    icon: palette.neutral[400],
    shadow: 'rgba(0, 0, 0, 0.3)',
    overlay: 'rgba(0, 0, 0, 0.7)',
    
    // Tab navigation colors
    tabIconDefault: palette.neutral[400],
    tabIconSelected: '#ffffff',
  },
};

// Topic-specific colors for your trivia app
export const topicColors = {
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
  'default': '#455A64',         // Blue Grey
};

// For backward compatibility
export const categoryColors = topicColors;

/* -------------------------------------------- */
/* TYPOGRAPHY                                    */
/* -------------------------------------------- */

// Font families
const fontFamily = {
  // Sans-serif fonts for regular text
  base: Platform.select({
    ios: 'System',
    android: 'Inter-Regular',
    default: 'Inter-Regular',
    web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  }),
  bold: Platform.select({
    ios: 'System-Bold',
    android: 'Inter-Bold',
    default: 'Inter-Bold',
    web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  }),
  italic: Platform.select({
    ios: 'System-Italic',
    android: 'Inter-Italic',
    default: 'Inter-Italic',
    web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  }),
  
  // Serif fonts (only for questions)
  serif: Platform.select({
    ios: 'Georgia',
    android: 'PlayfairDisplay-Regular',
    default: 'PlayfairDisplay-Regular',
    web: 'Georgia, Cambria, "Times New Roman", Times, serif',
  }),
  serifBold: Platform.select({
    ios: 'Georgia-Bold',
    android: 'PlayfairDisplay-Bold',
    default: 'PlayfairDisplay-Bold',
    web: 'Georgia, Cambria, "Times New Roman", Times, serif',
  }),
};

// Font sizes
const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
  '5xl': 48,
  '6xl': 64,
};

// Font weights
const fontWeight = {
  light: '300',
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
};

// Line heights
const lineHeight = {
  none: 1,
  tight: 1.25,
  normal: 1.5,
  loose: 1.75,
  xs: 16,
  sm: 20,
  md: 24,
  lg: 28,
  xl: 32,
  '2xl': 38,
  '3xl': 44,
  '4xl': 52,
  '5xl': 64,
};

// Letter spacing
const letterSpacing = {
  tighter: -0.5,
  tight: -0.25,
  normal: 0,
  wide: 0.25,
  wider: 0.5,
  widest: 1,
};

// Predefined text styles
export const textVariants = {
  // Headings - all sans-serif
  h1: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize['4xl'],
    lineHeight: lineHeight['4xl'],
    fontWeight: fontWeight.bold,
    letterSpacing: letterSpacing.tighter,
  },
  h2: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize['3xl'],
    lineHeight: lineHeight['3xl'],
    fontWeight: fontWeight.bold,
    letterSpacing: letterSpacing.tighter,
  },
  h3: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize['2xl'],
    lineHeight: lineHeight['2xl'],
    fontWeight: fontWeight.bold,
    letterSpacing: letterSpacing.tight,
  },
  h4: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xl,
    lineHeight: lineHeight.xl,
    fontWeight: fontWeight.bold,
    letterSpacing: letterSpacing.tight,
  },
  h5: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    lineHeight: lineHeight.lg,
    fontWeight: fontWeight.bold,
  },
  h6: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    lineHeight: lineHeight.md,
    fontWeight: fontWeight.bold,
  },
  
  // Body text - sans-serif
  body1: {
    fontFamily: fontFamily.base,
    fontSize: fontSize.md,
    lineHeight: lineHeight.md,
    fontWeight: fontWeight.normal,
  },
  body2: {
    fontFamily: fontFamily.base,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
    fontWeight: fontWeight.normal,
  },
  
  // Special text styles - sans-serif
  subtitle1: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    lineHeight: lineHeight.lg,
    fontWeight: fontWeight.semibold,
  },
  subtitle2: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    lineHeight: lineHeight.md,
    fontWeight: fontWeight.semibold,
  },
  caption: {
    fontFamily: fontFamily.base,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.xs,
    fontWeight: fontWeight.normal,
  },
  button: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    lineHeight: lineHeight.md,
    fontWeight: fontWeight.semibold,
    letterSpacing: letterSpacing.wide,
    textTransform: 'uppercase',
  },
  overline: {
    fontFamily: fontFamily.base,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.xs,
    fontWeight: fontWeight.medium,
    letterSpacing: letterSpacing.wider,
    textTransform: 'uppercase',
  },
  link: {
    fontFamily: fontFamily.base,
    fontSize: fontSize.md,
    lineHeight: lineHeight.md,
    color: palette.primary[500],
  },
  
  // Question text - only variant that uses serif
  question: {
    fontFamily: fontFamily.serif,
    fontSize: fontSize['3xl'],
    lineHeight: lineHeight['3xl'],
    letterSpacing: letterSpacing.tighter,
    fontWeight: fontWeight.bold,
  },
};

// Combined typography system
export const typography = {
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  letterSpacing,
  variants: textVariants,
};

/* -------------------------------------------- */
/* SPACING & LAYOUT                              */
/* -------------------------------------------- */

// Spacing scale (in pixels)
export const spacing = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  2.5: 10,
  3: 12,
  3.5: 14,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  9: 36,
  10: 40,
  11: 44,
  12: 48,
  14: 56,
  16: 64,
  20: 80,
  24: 96,
  28: 112,
  32: 128,
  36: 144,
  40: 160,
  44: 176,
  48: 192,
  52: 208,
  56: 224,
  60: 240,
  64: 256,
  72: 288,
  80: 320,
  96: 384,
};

// Z-index values
export const zIndex = {
  0: 0,
  10: 10,
  20: 20,
  30: 30,
  40: 40,
  50: 50,
  auto: 'auto',
  modal: 1000,
  tooltip: 1100,
  toast: 1200,
};

// Layout values
export const layout = {
  screenMargin: spacing[4],
  maxContentWidth: 1200,
};

/* -------------------------------------------- */
/* BORDERS & SHAPES                              */
/* -------------------------------------------- */

// Border radius values
export const borderRadius = {
  none: 0,
  xs: 2,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 24,
  '3xl': 32,
  full: 9999,
};

// Border width values
export const borderWidth = {
  0: 0,
  1: 1,
  2: 2,
  4: 4,
  8: 8,
};

/* -------------------------------------------- */
/* SHADOWS & ELEVATION                           */
/* -------------------------------------------- */

// Shadow styles (for different platforms)
export const shadows = {
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  xs: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  xl: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 12,
  },
};

/* -------------------------------------------- */
/* TRANSITIONS & ANIMATIONS                      */
/* -------------------------------------------- */

// Timing functions
export const transitions = {
  easing: {
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    easeOut: 'cubic-bezier(0.0, 0, 0.2, 1)',
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
    sharp: 'cubic-bezier(0.4, 0, 0.6, 1)',
  },
  duration: {
    shortest: 150,
    shorter: 200,
    short: 250,
    standard: 300,
    complex: 375,
    enteringScreen: 225,
    leavingScreen: 195,
  },
};

/* -------------------------------------------- */
/* BREAKPOINTS                                   */
/* -------------------------------------------- */

// Responsive breakpoints
export const breakpoints = {
  xs: 0,
  sm: 600,
  md: 960,
  lg: 1280,
  xl: 1920,
};

/* -------------------------------------------- */
/* EXPORT DESIGN SYSTEM                          */
/* -------------------------------------------- */

const designSystem = {
  colors,
  typography,
  spacing,
  layout,
  borderRadius,
  borderWidth,
  shadows,
  transitions,
  breakpoints,
  zIndex,
  categoryColors,
};

export default designSystem; 