import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Define colors as constants to avoid any potential issues
const DARK_COLORS = {
  background: '#1A1A1A',
  card: '#2E2E2E',
  text: '#FFFFFF',
  textSecondary: '#CCCCCC',
  border: '#404040',
  primary: '#ff9f43',
  input: '#333333',
  inputText: '#FFFFFF',
  placeholder: '#999999',
  error: '#FF3B30',
  errorLight: 'rgba(255, 59, 48, 0.1)',
};

const LIGHT_COLORS = {
  background: '#FFFFFF',
  card: '#F5F5F5',
  text: '#333333',
  textSecondary: '#666666',
  border: '#E0E0E0',
  primary: '#ff9f43',
  input: '#FFFFFF',
  inputText: '#333333',
  placeholder: '#999999',
  error: '#FF3B30',
  errorLight: 'rgba(255, 59, 48, 0.1)',
};

// Create context with guaranteed default values
const MainAppThemeContext = createContext({
  isDarkMode: true,
  colors: DARK_COLORS,
  toggleTheme: () => {},
});

export const ThemeProvider = ({ children }) => {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    loadTheme();
  }, []);

  const loadTheme = async () => {
    try {
      const savedTheme = await AsyncStorage.getItem('mainAppTheme');
      if (savedTheme) {
        setIsDarkMode(savedTheme === 'dark');
      }
    } catch (error) {
      console.error('Error loading theme:', error);
    } finally {
      setIsReady(true);
    }
  };

  const toggleTheme = async () => {
    try {
      const newTheme = !isDarkMode;
      setIsDarkMode(newTheme);
      await AsyncStorage.setItem('mainAppTheme', newTheme ? 'dark' : 'light');
    } catch (error) {
      console.error('Error saving theme:', error);
    }
  };

  // Ensure we always have a valid theme object
  const themeValue = {
    isDarkMode,
    colors: isDarkMode ? DARK_COLORS : LIGHT_COLORS,
    toggleTheme,
  };

  // Don't render until theme is ready
  if (!isReady) {
    return null;
  }

  return (
    <MainAppThemeContext.Provider value={themeValue}>
      {children}
    </MainAppThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(MainAppThemeContext);
  
  // Always return a valid theme object
  if (!context || !context.colors) {
    console.warn('ThemeContext: using fallback theme');
    return {
      isDarkMode: true,
      colors: DARK_COLORS,
      toggleTheme: () => {},
    };
  }
  
  return context;
};