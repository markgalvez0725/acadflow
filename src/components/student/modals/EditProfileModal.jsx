import React, { useState, useRef, useEffect } from 'react'
import { useData } from '@/context/DataContext'
import { useAuth } from '@/context/AuthContext'
import { useUI } from '@/context/UIContext'
import { fbDeleteStudent } from '@/firebase/persistence'
import { getFbAuth } from '@/firebase/firebaseInit'
import { isPendingVerification } from '@/utils/accountStatus'
import { dataGapReasons } from '@/utils/accountAudit'
import { validateSnum } from '@/utils/validate'
import { validateProfilePhoto } from '@/utils/photoValidate'
import { loadFaceModels } from '@/utils/faceId'
import Modal from '@/components/primitives/Modal'
import FieldCheck, { SaveStatus } from '@/components/primitives/FieldCheck'
import { checkRequiredName, checkMiddleInitial, checkEmail } from '@/utils/settingsVerify'
import { Camera, Lock, Timer, CheckCircle2, Save, Eye, EyeOff, ShieldCheck, AlertTriangle, XCircle, Loader2, RefreshCw, ChevronLeft } from 'lucide-react'

const SNUM_CHANGE_DAYS = 30
const YEAR_OPTIONS = ['1st Year', '2nd Year', '3rd Year', '4th Year']

// Names are stored canonically as "Surname, First Middle". Split a stored name
// back into parts for editing, and rebuild that exact structure on save.
// The middle is an initial by convention, so only a trailing single-letter token
// (e.g. the "G" in "Stephen Andrei G") is treated as the middle - the rest stays
// in the first name, keeping two-word first names like "Stephen Andrei" intact.
function parseStudentName(full) {
  const raw = (full || '').trim()
  if (!raw) return { surname: '', first: '', middle: '' }
  if (raw.includes(',')) {
    const [sur, rest = ''] = raw.split(/,(.+)/) // split on the FIRST comma only
    const parts = rest.trim().split(/\s+/).filter(Boolean)
    let firstParts = parts, middle = ''
    const lastTok = parts[parts.length - 1] || ''
    if (parts.length >= 2 && /^[A-Za-z]\.?$/.test(lastTok)) {
      middle = lastTok.replace(/\.$/, '') // trailing single letter → middle initial
      firstParts = parts.slice(0, -1)
    }
    return { surname: sur.trim(), first: firstParts.join(' '), middle }
  }
  // No comma - structure unknown; seed the first-name field so nothing is lost.
  return { surname: '', first: raw, middle: '' }
}

function buildStudentName(surname, first, middle) {
  const sur = (surname || '').trim()
  const fm = [(first || '').trim(), (middle || '').trim()].filter(Boolean).join(' ')
  return (sur ? `${sur}, ${fm}`.replace(/,\s*$/, '') : fm).toUpperCase()
}

export default function EditProfileModal({ student: s, onClose, forced = false, embedded = false, hideCancel = false }) {
  const { students, saveStudents, db } = useData()
  const { setCurrentStudent, logout } = useAuth()
  const { toast } = useUI()

  const _parsed = parseStudentName(s.name)
  const [surname,    setSurname]    = useState(_parsed.surname)
  const [firstName,  setFirstName]  = useState(_parsed.first)
  const [middleName, setMiddleName] = useState(_parsed.middle)
  const composedName = buildStudentName(surname, firstName, middleName)
  const [snum,   setSnum]   = useState(s.id      || '')
  const [course, setCourse] = useState(s.course  || '')
  const [year,   setYear]   = useState(s.year    || '1st Year')
  const [email,  setEmail]  = useState(s.account?.email || '')
  const [photo,  setPhoto]  = useState(s.photo   || null)
  const [error,  setError]  = useState('')
  const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)

  // ── On-device smart check + name auto-save ────────────────────────────────
  const surChk   = checkRequiredName(surname, 'Surname')
  const firstChk = checkRequiredName(firstName, 'First name')
  const miChk    = checkMiddleInitial(middleName)
  const emailChk = checkEmail(email, { required: false }) // email is optional
  const [nameStatus, setNameStatus] = useState('idle') // idle | saving | saved

  // Auto-save the name parts once both required parts are valid (debounced).
  // ONLY in normal edit mode - a forced/pending setup keeps its explicit verified
  // save so the Smart account verification runs exactly once when setup completes
  // (not on every keystroke). Photo + email keep their own explicit/confirm flows.
  const canAuto = !forced && !isPendingVerification(s)
  useEffect(() => {
    if (!canAuto) return
    if (surChk.state === 'error' || firstChk.state === 'error') return
    const newName = composedName.trim()
    // Compare case-insensitively so simply opening the modal (which uppercases the
    // canonical name) never triggers a write - only a real name change does.
    if (!newName || newName === (s.name || '').toUpperCase()) return
    setNameStatus('saving')
    const t = setTimeout(async () => {
      try {
        const updated = { ...s, name: newName }
        await saveStudents(students.map(x => x.id === s.id ? updated : x), [s.id])
        setCurrentStudent(updated)
        setNameStatus('saved')
        setTimeout(() => setNameStatus('idle'), 1500)
      } catch { setNameStatus('idle') }
    }, 1000)
    return () => clearTimeout(t)
  }, [surname, firstName, middleName]) // eslint-disable-line react-hooks/exhaustive-deps

  // Profile-photo validation (white background + business-attire headshot).
  // null = no new photo checked; { status:'checking'|'done', result } otherwise.
  const [photoCheck, setPhotoCheck] = useState(null)
  const photoBlocked = photoCheck?.status === 'done' && photoCheck.result && !photoCheck.result.ok
  // Retryable = couldn't verify (engine/connection), distinct from a photo that
  // failed a check. Shows "Try again" instead of "replace the photo".
  const photoRetryable = photoCheck?.status === 'done' && !!photoCheck.result?.retryable

  // Warm the one engine the photo check uses (face-api: face count + identity, plus
  // the face box that drives the pixel-based background/attire read) the moment the
  // modal opens, so the first check isn't a cold model download. Best-effort.
  useEffect(() => { loadFaceModels().catch(() => {}) }, [])

  // Email password-confirm flow
  const [emailStep,     setEmailStep]     = useState('idle') // 'idle' | 'confirm' | 'verified'
  const [confirmPass,   setConfirmPass]   = useState('')
  const [showPass,      setShowPass]      = useState(false)
  const [emailError,    setEmailError]    = useState('')

  async function handleConfirmPassword() {
    setEmailError('')
    const trimEmail = email.trim()
    if (!trimEmail.includes('@')) { setEmailError('Please enter a valid email address.'); return }
    if (!confirmPass) { setEmailError('Please enter your current password.'); return }

    const dup = students.find(x => x.id !== s.id && x.account?.registered && x.account?.email?.toLowerCase() === trimEmail.toLowerCase())
    if (dup) { setEmailError('This email is already linked to another account.'); return }

    const { verifyPassword } = await import('@/utils/crypto')
    const match = await verifyPassword(confirmPass, s.account?.pass ?? s.pass)
    if (!match) { setEmailError('Incorrect password.'); return }

    setEmailStep('verified')
    setConfirmPass('')
    setShowPass(false)
    toast('Email confirmed!', 'success')
  }

  // SNUM lock logic
  const now       = Date.now()
  const changedAt = s.snumChangedAt || 0
  const daysSince = changedAt ? Math.floor((now - changedAt) / 86400000) : 9999
  const daysLeft  = SNUM_CHANGE_DAYS - daysSince
  // Student numbers are managed by the professor. Locking this on the student side
  // keeps identity stable and lets Firestore rules forbid students from
  // re-creating their own record (which would bypass grade protection).
  const snumLocked = true

  let snumBadge = null
  let snumInfo  = ''
  if (snumLocked) {
    snumBadge = <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--red-l)', color: 'var(--red)', padding: '2px 7px', borderRadius: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}><Lock size={10} /> Locked</span>
    snumInfo  = 'Student number is locked. Contact your professor to update it.'
  } else if (changedAt && daysLeft > 0) {
    snumBadge = <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--yellow-l)', color: 'var(--yellow)', padding: '2px 7px', borderRadius: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}><Timer size={10} /> {daysLeft}d left</span>
    snumInfo  = `You can still change your student number for ${daysLeft} more day${daysLeft !== 1 ? 's' : ''}. After that it will be locked permanently.`
  } else {
    snumBadge = <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--green-l)', color: 'var(--green)', padding: '2px 7px', borderRadius: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}><CheckCircle2 size={10} /> Editable</span>
    snumInfo  = `You have ${SNUM_CHANGE_DAYS} days from your first save to update this. After that it locks permanently.`
  }

  // Run the full photo check on a loaded <img>. Shared by a new pick and by the
  // "Try again" button (which re-checks the SAME photo when the engine couldn't
  // run the first time, e.g. a flaky connection). Face count + identity + white
  // background all come from one verdict (validateProfilePhoto), so the panel can
  // never contradict itself.
  async function runPhotoCheck(img, dataUrl) {
    setPhotoCheck({ status: 'checking', result: null })
    try {
      const result = await validateProfilePhoto(img, dataUrl)
      setPhotoCheck({ status: 'done', result })
      if (result.retryable) toast('Couldn’t verify your photo. Check your connection and tap Try again.', 'warn', 6000)
      else if (!result.ok) toast('This photo needs changes before it can be saved.', 'warn', 5000)
      else if (result.warnings.length) toast('Photo accepted, see the notes below.', 'info', 4000)
      else toast('Photo verified!', 'success')
    } catch (err) {
      // An unexpected validator crash is treated as "couldn't verify" - block and
      // let the student retry rather than silently saving an unverified photo.
      setPhotoCheck({ status: 'done', result: { ok: false, hardFails: ['Couldn’t verify your photo on this device. Tap Try again.'], warnings: [], passes: [], smartUsed: false, retryable: true } })
    }
  }

  // Re-check the already-chosen photo (after a flaky-connection failure). The
  // resized dataUrl in `photo` is reloaded into an <img> and run through the gate.
  async function retryPhotoCheck() {
    if (!photo) return
    const img = new Image()
    img.onload = () => runPhotoCheck(img, photo)
    img.onerror = () => toast('Could not read that image.', 'warn')
    img.src = photo
  }

  function handlePhotoChange(e) {
    const file = e.target.files[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { toast('Please choose an image file.', 'warn'); return }
    if (file.size > 10 * 1024 * 1024) { toast('Photo must be under 10 MB.', 'warn'); return }
    const reader = new FileReader()
    reader.onload = ev => {
      // Resize to a small square-ish thumbnail so it stays well under
      // Firestore's 1 MB document limit and doesn't bloat roster reads.
      const img = new Image()
      img.onload = async () => {
        const MAX = 256
        const scale = Math.min(1, MAX / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, w, h)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
        setPhoto(dataUrl)
        // Run the gate on the full-resolution `img` for the best read.
        runPhotoCheck(img, dataUrl)
      }
      img.onerror = () => toast('Could not read that image.', 'warn')
      img.src = ev.target.result
    }
    reader.readAsDataURL(file)
  }

  async function handleSave() {
    setError('')
    const trimName   = composedName.trim()
    const trimCourse = course.trim()
    const trimSnum   = snum.trim()

    if (!surname.trim())   { setError('Surname is required.');    return }
    if (!firstName.trim()) { setError('First name is required.'); return }

    if (photoBlocked) {
      setError(photoRetryable
        ? 'We couldn’t verify your photo yet. Check your connection and tap Try again in the photo check below.'
        : 'Your profile photo does not meet the requirements. Please replace it (see the photo check below).')
      return
    }

    if (!snumLocked) {
      if (!trimSnum) { setError('Student number cannot be empty.'); return }
      const snumErr = validateSnum(trimSnum)
      if (snumErr) { setError(snumErr); return }
      if (trimSnum !== s.id) {
        const dup = students.find(x => x.id === trimSnum)
        if (dup) { setError(`Student number "${trimSnum}" is already assigned to ${dup.name}.`); return }
      }
    }

    setSaving(true)
    try {
      let finalSnum = snumLocked ? s.id : trimSnum
      const finalEmail = emailStep === 'verified' ? email.trim() : (s.account?.email || '')
      const pending = isPendingVerification(s)

      // A pending account auto-verifies ONLY once its self-fixable data gaps
      // (name/photo) are resolved - completion is the trigger. We re-run the Smart
      // check BEFORE saving the edited name, so the server scores the student's
      // claim against the professor's CURRENT roster record (not the edit scoring
      // against itself). The verified flag is set server-side; we then persist the
      // same value so the local doc and the rule agree.
      const remainingGaps = pending ? dataGapReasons({ ...s, name: trimName, photo: photo || null }) : []
      let verified = false
      let verification = s.account?.verification || null
      if (pending && remainingGaps.length === 0) {
        try {
          const fbUser = getFbAuth()?.currentUser
          if (fbUser) {
            const idToken = await fbUser.getIdToken()
            const resp = await fetch('/api/verify-account', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                idToken,
                studentNumber: s.id,
                name: trimName,
                course: s.course || '',
                year: s.year || year,
                section: s.section || '',
              }),
            })
            if (resp.ok) {
              const d = await resp.json().catch(() => ({}))
              verified = !!d.verified
              // Mirror the server's verification record so coverage reads "Smart",
              // not stale (the server set this authoritatively just now).
              if (verified) verification = { method: 'ai', confidence: d.confidence ?? null, fields: d.fields ?? null, at: Date.now() }
            }
          }
        } catch (_) { /* leave pending - professor will verify */ }
      }

      let updatedStudent = {
        ...s,
        id: finalSnum,
        name: trimName,
        // Course and year are locked to the professor's record (enrolled subjects
        // depend on them). Students can't change them here.
        course: s.course || '',
        year: s.year || year,
        photo: photo || null,
        account: { ...(s.account || {}), email: finalEmail, needsProfileSetup: false, ...(pending ? { verified, verification } : {}) },
      }

      if (!snumLocked && finalSnum !== s.id) {
        // snum changed - set timestamp if first change
        if (!s.snumChangedAt) updatedStudent.snumChangedAt = Date.now()
      }

      let updatedStudents
      if (!snumLocked && finalSnum !== s.id && db?.current) {
        // Delete old Firestore doc first
        await fbDeleteStudent(db.current, s.id)
        updatedStudents = [
          ...students.filter(x => x.id !== s.id),
          updatedStudent,
        ]
      } else {
        updatedStudents = students.map(x => x.id === s.id ? updatedStudent : x)
      }

      await saveStudents(updatedStudents, [finalSnum])

      // Update auth context
      setCurrentStudent(updatedStudent)

      // Update localStorage session
      try {
        const sess = JSON.parse(localStorage.getItem('cp_session') || '{}')
        if (sess.role === 'student') {
          sess.studentId = finalSnum
          sess.ts = Date.now()
          localStorage.setItem('cp_session', JSON.stringify(sess))
        }
      } catch (e) {}

      if (pending) {
        // The pending gate lifts live via the roster listener when verified flips.
        toast(verified
          ? '✅ Verified! Full access is now unlocked.'
          : remainingGaps.length
            ? `Profile saved. Still needed to unlock full access: ${remainingGaps.join(', ')}.`
            : 'Profile saved - your professor will confirm the change shortly.',
          verified ? 'success' : 'info')
        onClose()
        return
      }

      toast('Profile updated successfully!', 'success')
      onClose()
    } catch (e) {
      setError('Failed to save profile: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const inner = (
    <>
      <style>{`@keyframes epfSlideIn{from{transform:translateX(22px);opacity:.35}to{transform:translateX(0);opacity:1}} .epf-slide{animation:epfSlideIn .22s ease both}`}</style>
      <div className={embedded ? '' : 'epf-slide'}>
        {!forced && !embedded && (
          <button type="button" onClick={onClose} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink2)', fontSize: 13, fontWeight: 600, padding: 0, marginBottom: 8 }}>
            <ChevronLeft size={16} /> Back
          </button>
        )}
        {!embedded && <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginBottom: forced ? 6 : 20 }}>{forced ? 'Complete your profile' : 'Edit Profile'}</h3>}
        {forced && (
          <p style={{ fontSize: 12.5, color: 'var(--ink2)', marginBottom: 18, lineHeight: 1.5 }}>
            Review your details and add a photo to finish setting up your account. You can update these again later.
          </p>
        )}

        {/* Avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div
            className="stud-avatar"
            style={{ width: 64, height: 64, fontSize: 24, cursor: 'pointer', flexShrink: 0 }}
            onClick={() => fileRef.current?.click()}
            title="Change photo"
          >
            {photo
              ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
              : <span>{((composedName || 'S').trim()[0] || 'S').toUpperCase()}</span>
            }
          </div>
          <div>
            <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Camera size={14} /> Change Photo</button>
            {photo && (
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6, color: 'var(--red)' }} onClick={() => { setPhoto(null); setPhotoCheck(null); if (fileRef.current) fileRef.current.value = '' }}>Remove</button>
            )}
            <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 4 }}>Professional headshot · business attire · plain white background · PNG/JPG</div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoChange} />
        </div>

        {/* Profile-photo validation panel */}
        {photoCheck && (
          <div style={{
            marginBottom: 18, padding: '12px 14px', borderRadius: 12,
            border: `1px solid ${photoCheck.status === 'checking' ? 'var(--line)' : photoBlocked ? 'var(--red)' : (photoCheck.result?.warnings?.length ? 'var(--yellow)' : 'var(--green)')}`,
            background: photoCheck.status === 'checking' ? 'var(--bg2)' : photoBlocked ? 'var(--red-l)' : (photoCheck.result?.warnings?.length ? 'var(--yellow-l)' : 'var(--green-l)'),
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, fontSize: 13, marginBottom: photoCheck.status === 'checking' ? 0 : 8 }}>
              {photoCheck.status === 'checking'
                ? <><Loader2 size={15} className="spin" /> Checking your photo…</>
                : photoRetryable
                  ? <><AlertTriangle size={15} style={{ color: 'var(--red)' }} /> Couldn’t verify - try again</>
                  : photoBlocked
                    ? <><XCircle size={15} style={{ color: 'var(--red)' }} /> Photo can’t be used yet</>
                    : (photoCheck.result?.warnings?.length
                        ? <><AlertTriangle size={15} style={{ color: 'var(--yellow)' }} /> Photo accepted - please review</>
                        : <><ShieldCheck size={15} style={{ color: 'var(--green)' }} /> Photo verified</>)}
            </div>
            {photoCheck.status === 'checking' && (
              <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>Analyzing face, background, and attire on your device - the first check may take a moment.</div>
            )}
            {photoCheck.status === 'done' && photoCheck.result && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {photoCheck.result.hardFails.map((m, i) => (
                  <div key={'h' + i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: 'var(--red)' }}><XCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> {m}</div>
                ))}
                {photoCheck.result.warnings.map((m, i) => (
                  <div key={'w' + i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: 'var(--ink2)' }}><AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1, color: 'var(--yellow)' }} /> {m}</div>
                ))}
                {photoCheck.result.passes.map((m, i) => (
                  <div key={'p' + i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: 'var(--ink3)' }}><CheckCircle2 size={13} style={{ flexShrink: 0, marginTop: 1, color: 'var(--green)' }} /> {m}</div>
                ))}
                <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 4 }}>
                  {photoCheck.result.smartUsed ? 'Checked privately on your device - your photo never leaves it.' : 'Checked on your device. Tip: business attire on a plain white wall works best.'}
                  {photoRetryable
                    ? ' This is usually a slow connection, not your photo.'
                    : photoBlocked && ' Replace the photo or Remove it to continue.'}
                </div>
                {photoRetryable && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={retryPhotoCheck}
                    style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--accent)' }}
                  >
                    <RefreshCw size={13} /> Try again
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Name - kept structured as "Surname, First Middle" */}
        <div className="form-group">
          <label className="form-label">Surname *</label>
          <input className="input" value={surname} onChange={e => setSurname(e.target.value)} placeholder="e.g. Dela Cruz" />
          <FieldCheck result={surChk} />
        </div>
        <div className="form-group">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">First Name *</label>
              <input className="input" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="e.g. Juan" />
              <FieldCheck result={firstChk} />
            </div>
            <div>
              <label className="form-label">M.I. <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(optional)</span></label>
              <input className="input" value={middleName} onChange={e => setMiddleName(e.target.value)} placeholder="e.g. S" maxLength={4} />
              <FieldCheck result={miChk} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--ink3)' }}>
              Saved as: <strong style={{ color: 'var(--ink)' }}>{composedName || 'Surname, First M.I.'}</strong>
            </div>
            <SaveStatus status={nameStatus} />
          </div>
        </div>

        {/* Student Number */}
        <div className="form-group">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <label className="form-label" style={{ margin: 0 }}>Student Number</label>
            {snumBadge}
          </div>
          <input
            className="input"
            value={snum}
            onChange={e => !snumLocked && setSnum(e.target.value)}
            readOnly={snumLocked}
            style={snumLocked ? { background: 'var(--border)', color: 'var(--ink2)', cursor: 'not-allowed' } : {}}
          />
          {snumInfo && <div style={{ fontSize: 11, color: snumLocked ? 'var(--red)' : 'var(--ink3)', marginTop: 4 }}>{snumInfo}</div>}
        </div>

        <div className="form-group">
          <label className="form-label">Course / Program</label>
          <input
            className="input"
            value={course || '-'}
            readOnly
            disabled
            style={{ background: 'var(--border)', color: 'var(--ink2)', cursor: 'not-allowed' }}
          />
          <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>
            Set by your professor to match your enrolled subjects. Contact your professor to change it.
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Year Level</label>
          <input
            className="input"
            value={year || '-'}
            readOnly
            disabled
            style={{ background: 'var(--border)', color: 'var(--ink2)', cursor: 'not-allowed' }}
          />
          <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>
            Set by your professor. Contact your professor to change it.
          </div>
        </div>

        {/* Email */}
        <div className="form-group">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <label className="form-label" style={{ margin: 0 }}>Email Address</label>
            {emailStep === 'verified' && (
              <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--green-l)', color: 'var(--green)', padding: '2px 7px', borderRadius: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}><CheckCircle2 size={10} /> Confirmed</span>
            )}
          </div>
          <input
            className="input"
            type="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setEmailStep('idle'); setEmailError('') }}
            placeholder="your@email.com (optional)"
          />
          <FieldCheck result={emailChk} />

          {/* Password confirmation - shown when email differs and not yet verified */}
          {emailStep !== 'verified' && email.trim() && email.trim() !== (s.account?.email || '') && (
            <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 8 }}>
                Confirm your current password to save this email change.
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    className="input"
                    type={showPass ? 'text' : 'password'}
                    value={confirmPass}
                    onChange={e => { setConfirmPass(e.target.value); setEmailError('') }}
                    placeholder="Current password"
                    style={{ paddingRight: 36 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(v => !v)}
                    style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', padding: 0 }}
                  >
                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <button className="btn btn-ghost btn-sm" type="button" onClick={handleConfirmPassword} style={{ whiteSpace: 'nowrap' }}>
                  Confirm
                </button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setEmail(s.account?.email || ''); setEmailStep('idle'); setConfirmPass(''); setEmailError('') }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {emailError && (
            <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>{emailError}</div>
          )}
        </div>

        {error && (
          <div style={{ color: 'var(--red)', fontSize: 13, background: 'var(--red-l)', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-end mt-4">
          {!hideCancel && <button className="btn btn-ghost btn-sm" onClick={() => { if (forced) logout(); else onClose() }} disabled={saving}>{forced ? 'Sign out instead' : 'Cancel'}</button>}
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : <><Save size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />{forced ? 'Save & continue' : 'Save Profile'}</>}
          </button>
        </div>
      </div>
    </>
  )

  // Embedded: the shared SettingsShell provides the sheet/back/title chrome.
  if (embedded) return inner
  return <Modal onClose={forced ? undefined : onClose}>{inner}</Modal>
}
