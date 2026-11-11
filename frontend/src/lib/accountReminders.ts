const KEY = 'fixi-account-reminders'

export function dismissedAccountReminders(scope: string): string[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null')
    if (saved?.scope === scope && Array.isArray(saved.dismissed)) {
      return saved.dismissed.filter((id: unknown): id is string => typeof id === 'string')
    }
  } catch { /* Dismissal still works in memory when storage is unavailable. */ }
  return []
}

export function saveAccountReminders(scope: string, dismissed: string[]) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ scope, dismissed })) } catch { /* Keep the in-memory state. */ }
}

export function resetAccountReminders() {
  try { sessionStorage.removeItem(KEY) } catch { /* A new layout still starts with fresh reminders. */ }
}
