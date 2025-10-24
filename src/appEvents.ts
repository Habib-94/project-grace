// A tiny in-app event emitter used for cross-screen notifications.
// Very small and dependency-free.
type Handler = (payload?: any) => void;

const listeners: Record<string, Set<Handler>> = {};

export function emitAppEvent(event: string, payload?: any) {
  const set = listeners[event];
  if (!set) return;
  // copy to array in case handlers modify the set
  for (const h of Array.from(set)) {
    try {
      h(payload);
    } catch (e) {
      // don't let one handler break others
      // eslint-disable-next-line no-console
      console.warn('[appEvents] handler error', e);
    }
  }
}

export function onAppEvent(event: string, handler: Handler) {
  if (!listeners[event]) listeners[event] = new Set();
  listeners[event].add(handler);
  // return unsubscribe function
  return () => {
    try {
      listeners[event].delete(handler);
    } catch {
      // noop
    }
  };
}

// Optional helper to clear listeners (useful in tests)
export function clearAppEvents(event?: string) {
  if (typeof event === 'string') {
    delete listeners[event];
    return;
  }
  for (const k in listeners) {
    delete listeners[k];
  }
}