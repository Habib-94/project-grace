import Toast from 'react-native-toast-message';

/**
 * Centralized Toast error handler.
 * Safely extracts message from unknown error types.
 */
export const showError = (title: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  Toast.show({
    type: 'error',
    text1: title,
    text2: message,
  });
};
