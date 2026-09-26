import { allowCache } from "./cache.js";
const revoked = new Set<string>();

export function isAllowed(sessionId: string): boolean {
  if (allowCache.has(sessionId)) return true;
  if (revoked.has(sessionId)) return false;
  allowCache.set(sessionId, true);
  return true;
}

export function logout(sessionId: string): void {
  revoked.add(sessionId);
}
