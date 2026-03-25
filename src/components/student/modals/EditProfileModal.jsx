import React, { useState, useRef, useEffect } from 'react'
import { useData } from '@/context/DataContext'
import { useAuth } from '@/context/AuthContext'
import { useUI } from '@/context/UIContext'
import { fbDeleteStudent } from '@/firebase/persistence'
import { validateSnum } from '@/utils/validate'
import Modal from '@/components/primitives/Modal'
import { Camera, Lock, Timer, CheckCircle2, Save } from 'lucide-react'

const SNUM_CHANGE_DAYS = 30
const YEAR_OPTIONS = ['1st Year', '2nd Year', '3rd Year', '4th Year']

export default function EditProfileModal({ student: s, onClose }) {
  const { students, saveStudents, db, fbReady } = useData()
  const { setCurrentStudent } = useAuth()
  const { toast } = useUI()

  const [name,   setName]   = useState(s.name   || '')
  const [snum,   setSnum]   = useState(s.id      || '')
  const [course, setCourse] = useState(s.course  || '')
  const [year,   setYear]   = useState(s.year    || '1st Year')
  const [dob,    setDob]    = useState(s.dob     || '')
  const [mobile, setMobile] = useState(s.mobile  || '')
  const [photo,  setPhoto]  = useState(s.photo   || null)
  const [error,  setError]  = useState('')
  const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)

  // SNUM lock logic
  const now       = Date.now()
  const changedAt = s.snumChangedAt || 0
  const daysSince = changedAt ? Math.floor((now - changedAt) / 86400000) : 9999
  const daysLeft  = SNUM_CHANGE_DAYS - daysSince
  const snumLocked = changedAt && daysLeft <= 0

  let snumBadge = null
  let snumInfo  = ''
  if (snumLocked) {
    snumBadge = <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--red-l)', color: 'var(--red)', padding: '2px 7px', borderRadius: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}><Lock size={10} /> Locked</span>
    snumInfo  = 'Student number is locked. Contact your admin to update it.'
  } else if (changedAt && daysLeft > 0) {
    snumBadge = <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--yellow-l)', color: 'var(--yellow)', padding: '2px 7px', borderRadius: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}><Timer size={10} /> {daysLeft}d left</span>
    snumInfo  = `You can still change your student number for ${daysLeft} more day${daysLeft !== 1 ? 's' : ''}. After that it will be locked permanently.`
  } else {
    snumBadge = <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--green-l)', color: 'var(--green)', padding: '2px 7px', borderRadius: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}><CheckCircle2 size={10} /> Editable</span>
    snumInfo  = `You have ${SNUM_CHANGE_DAYS} days from your first save to update this. After that it locks permanently.`
  }

  function handlePhotoChange(e) {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { toast('Photo must be under 2 MB.', 'warn'); return }
    const reader = new FileReader()
    reader.onload = ev => setPhoto(ev.target.result)
    reader.readAsDataURL(file)
  }

  async function handleSave() {
    setError('')
    const trimName   = name.trim()
    const trimCourse = course.trim()
    const trimSnum   = snum.trim()

    if (!trimName)   { setError('Full name is required.');           return }
    if (!trimCourse) { setError('Course/Program is required.');      return }

    if (!snumLocked) {
      if (!trimSnum) { setError('Student number cannot be empty.'); return }
      const snumErr = validateSnum(trimSnum)
      if (snumErr) { setError(snumErr); return }
      if (trimSnum !== s.id) {
        const dup = students.find(x => x.id === trimSnum)
        if (dup) { setError(`⛔ Student number "${trimSnum}" is already assigned to ${dup.name}.`); return }
      }
    }

    setSaving(true)
    try {
      let finalSnum = snumLocked ? s.id : trimSnum
      let updatedStudent = {
        ...s,
        id: finalSnum,
        name: trimName,
        course: trimCourse,
        year,
        dob,
        mobile: mobile.trim(),
        photo: photo || null,
      }

      if (!snumLocked && finalSnum !== s.id) {
        // snum changed — set timestamp if first change
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

      toast('✅ Profile updated successfully!', 'success')
      onClose()
    } catch (e) {
      setError('❌ Failed to save profile: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div>
        <h3 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, marginBottom: 20 }}>Edit Profile</h3>

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
              : <span>{(name || 'S')[0].toUpperCase()}</span>
            }
          </div>
          <div>
            <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Camera size={14} /> Change Photo</button>
            {photo && (
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6, color: 'var(--red)' }} onClick={() => { setPhoto(null); if (fileRef.current) fileRef.current.value = '' }}>Remove</button>
            )}
            <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 4 }}>Max 2 MB · PNG/JPG</div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoChange} />
        </div>

        <div className="form-group">
          <label className="form-label">Full Name *</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
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
          <label className="form-label">Course / Program *</label>
          <input className="input" value={course} onChange={e => setCourse(e.target.value)} placeholder="e.g. BS Computer Science" />
        </div>

        <div className="form-group">
          <label className="form-label">Year Level</label>
          <select className="input" value={year} onChange={e => setYear(e.target.value)}>
            {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Date of Birth</label>
          <input className="input" type="date" value={dob} onChange={e => setDob(e.target.value)} />
        </div>

        <div className="form-group">
          <label className="form-label">Mobile Number</label>
          <input className="input" type="tel" value={mobile} onChange={e => setMobile(e.target.value)} placeholder="e.g. 09XXXXXXXXX" />
        </div>

        {error && (
          <div style={{ color: 'var(--red)', fontSize: 13, background: 'var(--red-l)', borderLeft: '3px solid var(--red)', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-end mt-4">
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : <><Save size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />Save Profile</>}
          </button>
        </div>
      </div>
    </Modal>
  )
}
