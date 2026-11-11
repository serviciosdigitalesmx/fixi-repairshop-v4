import { afterEach, describe, expect, it } from 'vitest'
import { dismissedAccountReminders, resetAccountReminders, saveAccountReminders } from './accountReminders'

afterEach(() => sessionStorage.clear())

describe('account reminder dismissals', () => {
  it('keeps tab dismissals scoped to the user and shop', () => {
    saveAccountReminders('user-a:shop-a', ['email', 'subscription:Trialing'])
    expect(dismissedAccountReminders('user-a:shop-a')).toEqual(['email', 'subscription:Trialing'])
    expect(dismissedAccountReminders('user-b:shop-a')).toEqual([])
    expect(dismissedAccountReminders('user-a:shop-b')).toEqual([])
  })

  it('starts fresh on a new entry without clearing unrelated session data', () => {
    sessionStorage.setItem('unrelated-preference', 'keep')
    saveAccountReminders('user-a:shop-a', ['email'])
    resetAccountReminders()
    expect(dismissedAccountReminders('user-a:shop-a')).toEqual([])
    expect(sessionStorage.getItem('unrelated-preference')).toBe('keep')
  })

  it('recovers from damaged stored data so pending reminders remain visible', () => {
    sessionStorage.setItem('fixi-account-reminders', '{invalid')
    expect(dismissedAccountReminders('user-a:shop-a')).toEqual([])
  })
})
