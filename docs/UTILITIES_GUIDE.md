# Security & Firebase Utilities - Quick Reference

## Import Statements

```typescript
// Security utilities
import { 
  sanitizeEmail, 
  sanitizeText, 
  sanitizeLocation,
  sanitizeColor,
  validateTeamName, 
  validatePassword,
  rateLimiter,
  redactSensitiveData 
} from '@/utils/security';

// Type-safe Firebase helpers
import { 
  addDocumentSafe,
  updateDocumentSafe,
  deleteDocumentSafe,
  setDocumentSafe,
  executeBatchOperations,
  isNativeFirestore
} from '@/utils/firebase-helpers';
```

## Security Utilities Usage

### Input Sanitization

```typescript
// Sanitize email (validates format and removes dangerous chars)
try {
  const cleanEmail = sanitizeEmail(userInput); // throws on invalid format
} catch (e) {
  // Handle invalid email
}

// Sanitize text (removes HTML, scripts, max length)
const cleanName = sanitizeText(userName, 100); // max 100 chars

// Sanitize location/address
const cleanLocation = sanitizeLocation(address); // max 200 chars

// Sanitize color codes
const cleanColor = sanitizeColor(userColor); // returns valid hex or #000000
```

### Validation

```typescript
// Validate team name
const result = validateTeamName(teamName);
if (!result.valid) {
  alert(result.error); // "Team name must be at least 2 characters"
}

// Validate password strength
const pwResult = validatePassword(password);
if (!pwResult.valid) {
  alert(pwResult.error); // "Password must contain at least one number"
}
```

### Rate Limiting

```typescript
// Check if action is allowed (max 3 per hour)
const userId = auth.currentUser?.uid;
const key = `createTeam:${userId}`;
const oneHour = 60 * 60 * 1000;

if (!rateLimiter.isAllowed(key, 3, oneHour)) {
  const resetMs = rateLimiter.getResetTime(key, oneHour);
  const resetMin = Math.ceil(resetMs / 60000);
  alert(`Please wait ${resetMin} minutes`);
  return;
}

// Proceed with action...
```

### Logging with Redaction

```typescript
// Redact sensitive fields before logging
console.log('User data:', redactSensitiveData(userData));
// Output: { name: 'John', password: '[REDACTED]', token: '[REDACTED]' }

// Custom sensitive keys
console.error('Error:', redactSensitiveData(
  { email: 'user@example.com', apiKey: 'secret123', error: err },
  ['email', 'apiKey'] // custom keys to redact
));
```

## Type-Safe Firebase Utilities Usage

### Add Document

```typescript
import { db } from '@/firebaseConfig';

if (!db) throw new Error('Database not initialized');

const docRef = await addDocumentSafe(db, 'teams', {
  teamName: sanitizeText(name),
  createdAt: new Date().toISOString(),
  createdBy: userId
});

const newId = docRef.id;
```

### Update Document

```typescript
await updateDocumentSafe(db, 'users', userId, {
  lastLogin: new Date().toISOString(),
  loginCount: 5
});
```

### Delete Document

```typescript
await deleteDocumentSafe(db, 'teams', teamId);
```

### Set/Upsert Document

```typescript
// Set with merge (upsert)
await setDocumentSafe(db, 'users', userId, {
  name: sanitizeText(userName),
  email: sanitizeEmail(email),
  updatedAt: new Date().toISOString()
}, { merge: true });

// Set without merge (overwrite)
await setDocumentSafe(db, 'settings', 'app', {
  version: '1.0.0'
});
```

### Batch Operations

```typescript
await executeBatchOperations(db, [
  {
    op: 'update',
    path: 'users/user123',
    data: { teamId: 'team456' }
  },
  {
    op: 'delete',
    path: 'requests/req789'
  },
  {
    op: 'update',
    path: 'teams/team456',
    data: { memberCount: 5 }
  }
]);
```

## Complete Example: Secure Form Submission

```typescript
import { useState } from 'react';
import { auth, db } from '@/firebaseConfig';
import { addDocumentSafe } from '@/utils/firebase-helpers';
import { 
  sanitizeText, 
  sanitizeEmail, 
  validateTeamName,
  rateLimiter,
  redactSensitiveData 
} from '@/utils/security';

async function handleSubmit() {
  const userId = auth.currentUser?.uid;
  if (!userId) return;

  // Rate limiting
  const rateLimitKey = `createTeam:${userId}`;
  if (!rateLimiter.isAllowed(rateLimitKey, 3, 60 * 60 * 1000)) {
    alert('Too many attempts. Please wait.');
    return;
  }

  // Validate
  const validation = validateTeamName(teamName);
  if (!validation.valid) {
    alert(validation.error);
    return;
  }

  // Sanitize
  const cleanName = sanitizeText(teamName, 50);
  const cleanLocation = sanitizeText(location, 200);

  try {
    if (!db) throw new Error('Database not initialized');
    
    const docRef = await addDocumentSafe(db, 'teams', {
      teamName: cleanName,
      location: cleanLocation,
      createdBy: userId,
      createdAt: new Date().toISOString()
    });

    console.log('Team created:', docRef.id);
  } catch (error) {
    console.error('Failed:', redactSensitiveData({ 
      teamName: cleanName, 
      error 
    }));
    alert('Failed to create team');
  }
}
```

## Migration Guide: Replacing `as any`

### Before:
```typescript
const a = auth as any;
await a.signOut();

const ref = await (db as any).collection('teams').add(data);
```

### After:
```typescript
import { hasAuthMethods } from '@/utils/firebase-helpers';

if (hasAuthMethods(auth)) {
  await auth.signOut();
}

const ref = await addDocumentSafe(db, 'teams', data);
```

## Best Practices

1. **Always sanitize user input** before storing or displaying
2. **Validate before sanitizing** to give better error messages
3. **Use rate limiting** for sensitive operations (create, delete, requests)
4. **Redact sensitive data** in all console.log/console.error calls
5. **Check db/auth initialization** before using Firebase utilities
6. **Use type guards** when working with Firebase instances
7. **Handle errors gracefully** with user-friendly messages
