// Security and input validation utilities

/**
 * Sanitize email input to prevent injection attacks
 */
export function sanitizeEmail(email: string): string {
  if (!email || typeof email !== 'string') return '';
  
  // Trim whitespace and convert to lowercase
  const sanitized = email.trim().toLowerCase();
  
  // Basic email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!emailRegex.test(sanitized)) {
    throw new Error('Invalid email format');
  }
  
  // Remove any potential script tags or special characters
  return sanitized.replace(/[<>'"]/g, '');
}

/**
 * Sanitize text input (team names, user names, etc.)
 * Removes potentially dangerous characters while preserving valid text
 */
export function sanitizeText(text: string, maxLength = 100): string {
  if (!text || typeof text !== 'string') return '';
  
  // Trim and limit length
  let sanitized = text.trim().slice(0, maxLength);
  
  // Remove script tags, HTML, and other dangerous patterns
  sanitized = sanitized
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]+>/g, '') // Remove HTML tags
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, ''); // Remove event handlers
  
  return sanitized;
}

/**
 * Validate team name
 */
export function validateTeamName(name: string): { valid: boolean; error?: string } {
  const sanitized = sanitizeText(name, 50);
  
  if (sanitized.length === 0) {
    return { valid: false, error: 'Team name cannot be empty' };
  }
  
  if (sanitized.length < 2) {
    return { valid: false, error: 'Team name must be at least 2 characters' };
  }
  
  // Only allow alphanumeric, spaces, hyphens, and apostrophes
  if (!/^[a-zA-Z0-9\s\-']+$/.test(sanitized)) {
    return { valid: false, error: 'Team name contains invalid characters' };
  }
  
  return { valid: true };
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }
  
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter' };
  }
  
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter' };
  }
  
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number' };
  }
  
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one special character' };
  }
  
  return { valid: true };
}

/**
 * Check individual password requirements for UI feedback
 */
export function checkPasswordRequirements(password: string) {
  return {
    minLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasSpecialChar: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
  };
}

/**
 * Sanitize location/address text
 */
export function sanitizeLocation(location: string): string {
  return sanitizeText(location, 200);
}

/**
 * Simple rate limiter using local storage
 * Returns true if action is allowed, false if rate limited
 */
export class RateLimiter {
  private storage: Map<string, number[]> = new Map();
  
  /**
   * Check if action is allowed
   * @param key - Unique identifier for the action (e.g., 'createTeam:userId')
   * @param maxActions - Maximum number of actions allowed
   * @param windowMs - Time window in milliseconds
   */
  isAllowed(key: string, maxActions: number, windowMs: number): boolean {
    const now = Date.now();
    const timestamps = this.storage.get(key) || [];
    
    // Remove timestamps outside the window
    const validTimestamps = timestamps.filter(ts => now - ts < windowMs);
    
    if (validTimestamps.length >= maxActions) {
      return false;
    }
    
    // Add current timestamp
    validTimestamps.push(now);
    this.storage.set(key, validTimestamps);
    
    return true;
  }
  
  /**
   * Get remaining time in milliseconds until rate limit resets
   */
  getResetTime(key: string, windowMs: number): number {
    const timestamps = this.storage.get(key) || [];
    if (timestamps.length === 0) return 0;
    
    const oldestTimestamp = Math.min(...timestamps);
    const resetTime = oldestTimestamp + windowMs;
    return Math.max(0, resetTime - Date.now());
  }
  
  /**
   * Clear rate limit for a specific key
   */
  reset(key: string): void {
    this.storage.delete(key);
  }
}

// Export a singleton instance
export const rateLimiter = new RateLimiter();

/**
 * Sanitize hex color value
 */
export function sanitizeColor(color: string): string {
  if (!color || typeof color !== 'string') return '#000000';
  
  // Remove any whitespace
  const cleaned = color.trim();
  
  // Check if it's a valid hex color (with or without #)
  const hexRegex = /^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
  
  if (!hexRegex.test(cleaned)) {
    return '#000000'; // Default to black if invalid
  }
  
  // Ensure it starts with #
  return cleaned.startsWith('#') ? cleaned : `#${cleaned}`;
}

/**
 * Prevent logging of sensitive information
 * Use this to redact sensitive fields before logging
 */
export function redactSensitiveData<T extends Record<string, any>>(
  data: T,
  sensitiveKeys: string[] = ['password', 'token', 'apiKey', 'secret']
): Record<string, any> {
  const redacted: Record<string, any> = { ...data };
  
  for (const key of sensitiveKeys) {
    if (key in redacted) {
      redacted[key] = '[REDACTED]';
    }
  }
  
  return redacted;
}
