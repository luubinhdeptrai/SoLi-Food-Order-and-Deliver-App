import { AppState, Platform } from 'react-native';
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { Stack } from 'expo-router';
import { useEffect } from 'react';

// 1. Create the client
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2 } },
});

// 2. Setup Online Manager (Detects Wi-Fi/Data changes)
onlineManager.setEventListener((setOnline) => {
  return NetInfo.addEventListener((state) => {
    setOnline(!!state.isConnected);
  });
});

// 3. Setup Focus Manager (Detects App background/foreground)
useEffect(() => {
  const subscription = AppState.addEventListener('change', (status) => {
    if (Platform.OS !== 'web') {
      focusManager.setFocused(status === 'active');
    }
  });
  return () => subscription.remove();
}, []);

return (
  <QueryClientProvider client={queryClient}>
    <Stack />
  </QueryClientProvider>
);
