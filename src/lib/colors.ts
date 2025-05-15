// Import category colors from NeonColors for consistency
import { NeonCategoryColors, getCategoryColor as getNeonColor } from '@/constants/NeonColors';
import { useTheme } from '@/src/context/ThemeContext';

// A mapping of each topic to a specific background color
export const topicColors: Record<string, string> = {
  // Main categories - full spectrum
  'Music': '#6200EA',           // Deep Purple
  'Entertainment': '#FF4081',   // Pink
  'Science': '#00B8D4',         // Cyan
  'History': '#D500F9',         // Purple
  'Pop Culture': '#FFD600',     // Yellow
  'Miscellaneous': '#FF9800',   // Orange
  'Literature': '#D50000',      // Red
  'Technology': '#304FFE',      // Indigo
  'Arts': '#F50057',            // Pink
  'Culture': '#9C27B0',         // Purple
  'Politics': '#651FFF',        // Deep Purple
  'Geography': '#00C853',       // Green
  'Chemistry': '#00BCD4',       // Cyan
  'Countries': '#3F51B5',       // Indigo
  'Nature': '#64DD17',          // Light Green
  'Biology': '#00C853',         // Green
  'Physics': '#FFD600',         // Yellow
  'Environment': '#4CAF50',     // Green
  'Ancient History': '#9C27B0', // Purple
  'Language': '#2962FF',        // Blue
  'Modern History': '#7E57C2',  // Deep Purple
  'Sports': '#FF6D00',          // Orange
  'Art': '#F50057',             // Pink
  'Astronomy': '#673AB7',       // Deep Purple
  'Engineering': '#FF5722',     // Deep Orange
  'Mathematics': '#00BFA5',     // Teal
  'General Knowledge': '#00BFA5', // Teal
  'Food and Drink': '#FF3D00',  // Deep Orange
  'Computers': '#0288D1',       // Light Blue
  'Math': '#00BFA5',            // Teal
  'Food': '#FF3D00',            // Deep Orange
  
  // Special categories
  'Modern Cinema': '#C51162',   // Pink
  'Mythology': '#AA00FF',       // Purple
  'Animals': '#76FF03',         // Light Green
  'Movies': '#673AB7',          // Deep Purple
  
  // Default fallback color
  'default': '#455A64'          // Blue Grey
};

// For backward compatibility
export const categoryColors = topicColors;

// Function to get a color for a given topic
export function getTopicColor(category: string): string {
  // Try direct match first (case insensitive)
  const lowerCategory = category.toLowerCase();
  
  // Exact match (case-insensitive)
  if (topicColors[category]) {
    return topicColors[category];
  }
  
  // Try partial match (if "History" isn't found, but "American History" is provided, use History's color)
  const partialMatch = Object.keys(topicColors).find(key => 
    lowerCategory.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerCategory)
  );
  
  if (partialMatch) {
    console.log(`Using color for "${partialMatch}" as a match for "${category}"`);
    return topicColors[partialMatch];
  }
  
  // Default fallback color
  return topicColors.default;
}

// Function to get a color with neon theme support
export function getTopicColorWithTheme(category: string, isNeonTheme = false): string {
  // If in neon theme, use the hex color from neon category colors
  if (isNeonTheme) {
    // Use the helper function from NeonColors
    return getNeonColor(category).hex;
  }
  
  // For standard theme, use the standard topic colors
  return getTopicColor(category);
}

// Export old function names for backward compatibility
export const getCategoryColor = getTopicColor;
export const getCategoryColorWithTheme = getTopicColorWithTheme; 