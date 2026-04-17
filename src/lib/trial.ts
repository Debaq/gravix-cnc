const TRIAL_DAYS = 30
const FIRST_RUN_KEY = 'gravix_first_run'

export function getTrialDaysLeft(): number {
  const stored = localStorage.getItem(FIRST_RUN_KEY)
  if (!stored) {
    localStorage.setItem(FIRST_RUN_KEY, Date.now().toString())
    return TRIAL_DAYS
  }
  const elapsed = (Date.now() - parseInt(stored)) / (1000 * 60 * 60 * 24)
  return Math.max(0, Math.floor(TRIAL_DAYS - elapsed))
}

export function isTrialActive(): boolean {
  return getTrialDaysLeft() > 0
}
