export function generateAuthToken(sessionId: string): string {
  const payload = { sessionId, timestamp: Date.now() };
  return btoa(JSON.stringify(payload));
}

export function validateAuthToken(token: string, sessionId: string): boolean {
  try {
    const payload = JSON.parse(atob(token));
    const age = Date.now() - payload.timestamp;
    return payload.sessionId === sessionId && age < 3600000; // 1 hour
  } catch {
    return false;
  }
}
