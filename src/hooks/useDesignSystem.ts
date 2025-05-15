import { categoryColors, topicColors } from '../design/index';
import { useTheme } from '../context/ThemeContext';
import { ThemeDefinition } from '../design/themes';

/**
 * Hook for accessing the design system with current theme awareness
 * This provides a centralized way to access all design tokens with the correct theme applied
 */
export function useDesignSystem() {
  const { colorScheme, themeDefinition } = useTheme();
  const isDark = colorScheme === 'dark';
  
  // Get the colors for the current color scheme
  const themeColors = isDark ? themeDefinition.colors.dark : themeDefinition.colors.light;

  return {
    colors: themeColors,
    typography: themeDefinition.typography,
    spacing: themeDefinition.spacing,
    borderRadius: themeDefinition.borderRadius,
    shadows: themeDefinition.shadows,
    animations: themeDefinition.animations,
    isDark,
    colorScheme,
  };
}

/**
 * Hook to get a specific color from the current theme
 */
export function useThemeColor(colorName: keyof ReturnType<typeof useDesignSystem>['colors']) {
  const { colors } = useDesignSystem();
  return colors[colorName];
}

/**
 * Helper to get topic-specific colors (preferred method)
 */
export function getTopicColor(category: string): string {
  // Use the imported colors or fall back to hard-coded values
  if (topicColors && typeof topicColors === 'object') {
    // Try to get direct match
    if (category in topicColors) {
      return (topicColors as Record<string, string>)[category];
    }
    
    // Try to find a partial match
    const partialMatch = Object.keys(topicColors).find(key => 
      category.toLowerCase().includes(key.toLowerCase()) || 
      key.toLowerCase().includes(category.toLowerCase())
    );
    
    if (partialMatch) {
      return (topicColors as Record<string, string>)[partialMatch];
    }
    
    // Return default color if no match found
    return (topicColors as Record<string, string>)['default'] || '#455A64';
  }
  
  // Fall back to hard-coded values if import fails
  const defaultTopicColors: Record<string, string> = {
    'Music': '#6200EA',           // Deep Purple
    'Entertainment': '#FF4081',   // Pink
    'Science': '#00B8D4',         // Cyan  
    'History': '#D500F9',         // Purple
    'Pop Culture': '#FFD600',     // Yellow
    'Miscellaneous': '#FF9800',   // Orange
    'default': '#455A64',         // Blue Grey
  };
  
  // Try to get direct match from fallback
  if (defaultTopicColors[category]) {
    return defaultTopicColors[category];
  }
  
  // Try to find a partial match in fallback
  const partialMatch = Object.keys(defaultTopicColors).find(key => 
    category.toLowerCase().includes(key.toLowerCase()) || 
    key.toLowerCase().includes(category.toLowerCase())
  );
  
  if (partialMatch) {
    return defaultTopicColors[partialMatch];
  }
  
  // Return default color if no match found
  return defaultTopicColors.default;
}

/**
 * Helper to get category-specific colors (legacy method)
 * This is maintained for backward compatibility
 */
export function getCategoryColor(category: string, theme?: ThemeDefinition): string {
  // Simply use getTopicColor for consistency
  return getTopicColor(category);
}
