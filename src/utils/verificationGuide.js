// On-device "Smart" guidance engine for the guided account-verification flow.
// Pure + deterministic (the same on-device pattern used elsewhere in the app):
// given a student's LIVE account state, it decides which step is active, the
// stepper status, and a friendly, context-aware guidance message. It reads the
// real signals already in the codebase (temp password, profile data gaps,
// identity-verification flag, Face-ID enrollment) so the narration always
// reflects the student's actual situation - never canned filler.

import { isPendingVerification } from './accountStatus'
import { dataGapReasons } from './accountAudit'

// "SURNAME, First M.I." → "First". Falls back to the first token.
export function firstNameOf(name) {
  const n = (name || '').trim()
  if (!n) return ''
  const after = n.includes(',') ? n.split(',').pop() : n
  return (after || '').trim().split(/\s+/)[0] || ''
}

// Decompose the live account state into the booleans the flow reasons about.
export function verificationState(student) {
  const a = student?.account || {}
  const tempPass = a._tempPass === true
  const pendingVerify = isPendingVerification(student) // registered && verified === false
  const gaps = dataGapReasons(student || {})           // missing photo / surname
  const needsProfileData = a.needsProfileSetup === true || gaps.length > 0
  const faceOn = a.faceResetEnabled === true
  return { tempPass, pendingVerify, gaps, needsProfileData, faceOn, hasPhoto: !!student?.photo }
}

// Step catalog (icon names map to lucide components in the component).
export const STEP_DEFS = {
  password: { key: 'password', label: 'Set your password',       icon: 'KeyRound' },
  profile:  { key: 'profile',  label: 'Complete your profile',   icon: 'Camera' },
  face:     { key: 'face',     label: 'Set up Face ID reset',     icon: 'ScanFace' },
}

// The steps that apply to this student, captured once (at mount) for a STABLE
// stepper. Password only appears for professor-provisioned (temp-password) accounts.
export function applicableSteps(student) {
  const s = verificationState(student)
  const keys = []
  if (s.tempPass) keys.push('password')
  // Face ID is enrolled BEFORE the photo: the enrolled signature is the trusted
  // anchor the profile photo is then matched against (api/match-face-photo).
  keys.push('face', 'profile')
  return keys
}

// The single step the student should act on right now. `triedVerify` flips after
// a profile save so a still-unconfirmed identity routes to the waiting state
// instead of looping back to the editor.
export function activeStep(student, { triedVerify = false } = {}) {
  const s = verificationState(student)
  if (s.tempPass) return 'password'
  if (!s.faceOn) return 'face'                 // enroll Face ID first (the anchor)
  if (s.needsProfileData) return 'profile'
  if (s.pendingVerify) return triedVerify ? 'awaiting' : 'profile'
  return 'done'
}

// Per-step status for the stepper dots: done | current | todo.
export function stepViews(student, frozenKeys, active) {
  const s = verificationState(student)
  const done = {
    password: !s.tempPass,
    profile:  !s.needsProfileData && !s.pendingVerify,
    face:     s.faceOn,
  }
  const curKey = active === 'awaiting' ? 'profile' : active
  return frozenKeys.map(k => ({
    key: k,
    label: STEP_DEFS[k].label,
    icon: STEP_DEFS[k].icon,
    status: done[k] ? 'done' : (k === curKey ? 'current' : 'todo'),
  }))
}

// The guidance bubble for the active step - what the on-device assistant "says".
export function verificationGuidance(student, active) {
  const fn = firstNameOf(student?.name)
  const hi = fn ? `Hi ${fn}` : 'Hi'
  switch (active) {
    case 'password':
      return {
        tone: 'accent', title: 'Set your password',
        text: `${hi} 👋 First, set a password only you know. Enter the temporary password your professor gave you, then choose a new one - at least 8 characters with an uppercase letter and a number.`,
      }
    case 'profile':
      return {
        tone: 'accent', title: 'Complete your profile',
        text: isPendingVerification(student)
          ? `Add a clear headshot: plain white background, business attire, facing the camera. I'll check it on your device, confirm it matches the face you just enrolled, and match you to your class roster automatically.`
          : `Add a clear profile photo and confirm your name so your professor can recognize you. I'll check the photo and confirm it matches your Face ID as you go.`,
      }
    case 'awaiting':
      return {
        tone: 'warn', title: 'Almost there',
        text: `Thanks - your details are in. I couldn't auto-confirm your identity just yet, so your professor will review it shortly. You'll get the verified badge the moment they confirm. You can keep using the rest of the app meanwhile.`,
      }
    case 'face':
      return {
        tone: 'accent', title: 'Set up Face ID',
        text: `Next${fn ? `, ${fn}` : ''}, let's set up Face ID. Enroll your face so you can reset your own password anytime, and so I can confirm your profile photo is really you. I only store a math signature of your face, never the photo. Center your face in the circle and hold still.`,
      }
    case 'done':
      return {
        tone: 'success', title: "You're verified!",
        text: `🎉 All done${fn ? `, ${fn}` : ''}! Your account is verified. Your grades, quizzes, and activities are unlocked.`,
      }
    default:
      return { tone: 'accent', title: 'Get verified', text: '' }
  }
}

// Short sub-label for the pinned "Get verified" banner in Settings.
export function verifyBannerSub(student) {
  const frozen = applicableSteps(student)
  const remaining = stepViews(student, frozen, activeStep(student))
    .filter(v => v.status !== 'done').length
  if (remaining <= 0) return 'Finishing up…'
  return `${remaining} step${remaining > 1 ? 's' : ''} left · unlock grades & quizzes`
}
