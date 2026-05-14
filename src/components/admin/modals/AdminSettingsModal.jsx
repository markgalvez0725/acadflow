import React, { useState, useMemo } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { fbWithTimeout } from '@/firebase/firebaseInit'
import Modal, { ModalHeader } from '@/components/primitives/Modal'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { encryptFbConfig, loadFbConfigFromStorage } from '@/utils/crypto'
import { getFbConfigFromEnv } from '@/firebase/firebaseInit'
import { verifyPassword, hashPassword } from '@/utils/crypto'
import { gradeInfo, DEFAULT_EQ_SCALE } from '@/utils/grades'
import { saveSettingsToFirebase } from '@/firebase/settings'

const TABS = [
  { id: 'semester', label: '🗓 Semester' },
  { id: 'cred',     label: 'Credentials' },
  { id: 'eq',       label: 'Equiv Scale' },
  { id: 'firebase', label: 'Firebase' },
]

// ── Semester Tab ──────────────────────────────────────────────────────────────
const STATUS_OPTS = [
  { value: 'upcoming', label: '⏳ Upcoming' },
  { value: 'active',   label: '✅ Active / Open' },
  { value: 'ended',    label: '🏁 Ended' },
]

function SemesterTab() {
  const { semester, saveSemester } = useData()
  const { toast } = useUI()

  const [term,      setTerm]      = useState(semester?.term      || '1st Semester')
  const [year,      setYear]      = useState(semester?.year      || '')
  const [status,    setStatus]    = useState(semester?.status    || 'active')
  const [startDate, setStartDate] = useState(semester?.startDate || '')
  const [endDate,   setEndDate]   = useState(semester?.endDate   || '')
  const [saving,    setSaving]    = useState(false)

  const previewLabel = term && year ? `${term} AY ${year.trim()}` : ''

  async function handleSave(e) {
    e.preventDefault()
    if (!year.trim()) { toast('Academic year is required (e.g. 2025-2026).', 'warn'); return }
    setSaving(true)
    try {
      const sem = {
        term,
        year: year.trim(),
        status,
        startDate,
        endDate,
        label: `${term} AY ${year.trim()}`,
        updatedAt: new Date().toISOString(),
      }
      await saveSemester(sem)
      toast('Semester info saved!', 'success')
    } catch (e) {
      toast('Failed to save semester: ' + e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Current semester info banner */}
      {semester && (
        <div className="bg-[var(--accent-l)] rounded-[10px] px-4 py-3 flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="text-xs text-[var(--ink3)] mb-0.5">Current Semester</div>
            <div className="font-bold text-[15px] text-[var(--accent)]">
              {semester.label || `${semester.term} AY ${semester.year}`}
            </div>
            {(semester.startDate || semester.endDate) && (
              <div className="text-[11px] text-[var(--ink3)] mt-0.5">
                {semester.startDate && new Date(semester.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                {semester.startDate && semester.endDate && ' → '}
                {semester.endDate && new Date(semester.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            )}
          </div>
          <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full text-white ${semester.status === 'active' ? 'bg-[var(--green)]' : semester.status === 'ended' ? 'bg-[var(--red)]' : 'bg-[var(--yellow)]'}`}>
            {STATUS_OPTS.find(o => o.value === semester.status)?.label || semester.status}
          </span>
        </div>
      )}

      <form onSubmit={handleSave} className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="form-label">Semester Term</label>
            <select className="form-input" value={term} onChange={e => setTerm(e.target.value)}>
              <option value="1st Semester">1st Semester</option>
              <option value="2nd Semester">2nd Semester</option>
              <option value="Summer">Summer</option>
            </select>
          </div>
          <div>
            <label className="form-label">Academic Year</label>
            <input
              className="form-input"
              value={year}
              onChange={e => setYear(e.target.value)}
              placeholder="e.g. 2025-2026"
            />
          </div>
        </div>

        <div>
          <label className="form-label">Status</label>
          <select className="form-input" value={status} onChange={e => setStatus(e.target.value)}>
            {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="form-label">Start Date</label>
            <input className="form-input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="form-label">End Date</label>
            <input className="form-input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
        </div>

        {previewLabel && (
          <div className="text-xs bg-[var(--surface2)] rounded-lg px-3 py-2 text-[var(--ink2)]">
            Label preview: <strong className="text-[var(--ink)]">{previewLabel}</strong>
          </div>
        )}

        <div>
          <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save Semester Info'}
          </button>
        </div>
      </form>

      <div className="text-xs text-[var(--ink3)] bg-[var(--surface2)] rounded-lg px-3 py-2.5 leading-relaxed">
        <strong>💡 Semester Workflow:</strong><br />
        1. Set the semester here before the term begins.<br />
        2. <strong>Setting status to ✅ Active / Open</strong> automatically opens enrollment for all classes assigned to this semester. Setting it to ⏳ Upcoming or 🏁 Ended automatically closes their enrollment.<br />
        3. When a class is <em>archived</em>, enrolled students' subject records are automatically snapshotted and cleared — they appear in each student's Academic History.<br />
        4. <em>Unarchive</em> a class to make it active again, then re-enroll students manually via the Students tab.
      </div>
    </div>
  )
}

// ── Credentials Tab ──────────────────────────────────────────────────────────
function CredentialsTab() {
  const { admin, saveAdmin } = useData()
  const { toast } = useUI()

  const [email,        setEmail]        = useState(admin.email || '')
  const [curPass,      setCurPass]      = useState('')
  const [newPass,      setNewPass]      = useState('')
  const [confPass,     setConfPass]     = useState('')
  const [pin,          setPin]          = useState('')
  const [pinConf,      setPinConf]      = useState('')
  const [saving,       setSaving]       = useState(false)

  async function handleSaveEmail(e) {
    e.preventDefault()
    if (!email.trim()) return
    setSaving(true)
    await saveAdmin({ ...admin, email: email.trim() })
    setSaving(false)
    toast('Email updated.', 'success')
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    if (!curPass || !newPass || !confPass) { toast('Fill in all password fields.', 'warn'); return }
    const ok = await verifyPassword(curPass, admin.pass)
    if (!ok) { toast('Current password is incorrect.', 'error'); return }
    if (newPass !== confPass) { toast('New passwords do not match.', 'error'); return }
    if (newPass.length < 8) { toast('Password must be at least 8 characters.', 'warn'); return }
    setSaving(true)
    const hashed = await hashPassword(newPass)
    await saveAdmin({ ...admin, pass: hashed })
    setSaving(false)
    setCurPass(''); setNewPass(''); setConfPass('')
    toast('Password changed.', 'success')
  }

  async function handleSavePin(e) {
    e.preventDefault()
    if (!/^\d{4}$/.test(pin)) { toast('PIN must be exactly 4 digits.', 'warn'); return }
    if (pin !== pinConf) { toast('PINs do not match.', 'error'); return }
    setSaving(true)
    const hashed = await hashPassword(pin)
    await saveAdmin({ ...admin, resetPin: hashed })
    setSaving(false)
    setPin(''); setPinConf('')
    toast('Recovery PIN saved.', 'success')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Email */}
      <form onSubmit={handleSaveEmail}>
        <div className="form-label" style={{ fontWeight: 600, marginBottom: 10 }}>Admin Email</div>
        <div className="flex gap-2">
          <input
            className="form-input flex-1"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="admin@school.edu"
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>Used for OTP delivery and notifications.</div>
      </form>

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />

      {/* Password */}
      <form onSubmit={handleChangePassword}>
        <div className="form-label" style={{ fontWeight: 600, marginBottom: 10 }}>Change Password</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input className="form-input" type="password" placeholder="Current password" value={curPass} onChange={e => setCurPass(e.target.value)} />
          <input className="form-input" type="password" placeholder="New password (min 8 chars)" value={newPass} onChange={e => setNewPass(e.target.value)} />
          <input className="form-input" type="password" placeholder="Confirm new password" value={confPass} onChange={e => setConfPass(e.target.value)} />
        </div>
        <button className="btn btn-primary btn-sm" type="submit" disabled={saving} style={{ marginTop: 10 }}>{saving ? 'Saving…' : 'Update Password'}</button>
      </form>

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />

      {/* Recovery PIN */}
      <form onSubmit={handleSavePin}>
        <div className="form-label" style={{ fontWeight: 600, marginBottom: 4 }}>Recovery PIN</div>
        <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 10 }}>
          {admin.resetPin ? 'A PIN is currently set.' : 'No PIN set yet.'} Used for password reset without email.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="form-input"
            type="password"
            maxLength={4}
            placeholder="4-digit PIN"
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            style={{ width: 110 }}
          />
          <input
            className="form-input"
            type="password"
            maxLength={4}
            placeholder="Confirm PIN"
            value={pinConf}
            onChange={e => setPinConf(e.target.value.replace(/\D/g, '').slice(0, 4))}
            style={{ width: 110 }}
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Set PIN'}</button>
        </div>
      </form>
    </div>
  )
}


// ── Equiv Scale Tab ───────────────────────────────────────────────────────────
const EQ_LABELS = ['1.00', '1.25', '1.50', '1.75', '2.00', '2.25', '2.50', '2.75', '3.00', '4.00']

function EquivScaleTab() {
  const { eqScale, saveEquivScale, db, fbReady } = useData()
  const { toast } = useUI()

  const [scores, setScores] = useState(() => eqScale.map(t => String(t.minScore)))
  const [saving, setSaving] = useState(false)
  const [settingDefault, setSettingDefault] = useState(false)

  const previewScale = useMemo(() => {
    return scores.map((s, i) => ({
      minScore: parseFloat(s) || 0,
      equiv: eqScale[i]?.equiv ?? (i + 1),
      label: EQ_LABELS[i] || String(i + 1),
    }))
  }, [scores, eqScale])

  function handleChange(i, val) {
    setScores(prev => { const n = [...prev]; n[i] = val; return n })
  }

  async function handleSave() {
    const parsed = scores.map((s, i) => ({ ...eqScale[i], minScore: parseFloat(s) || 0 }))
    // Validate descending
    for (let i = 1; i < parsed.length; i++) {
      if (parsed[i].minScore >= parsed[i - 1].minScore) {
        toast(`Score for ${EQ_LABELS[i]} must be less than ${EQ_LABELS[i - 1]}.`, 'warn'); return
      }
    }
    setSaving(true)
    await saveEquivScale(parsed)
    setSaving(false)
    toast('Equivalency scale saved.', 'success')
  }

  async function handleSetDefault() {
    const parsed = scores.map((s, i) => ({ ...eqScale[i], minScore: parseFloat(s) || 0 }))
    setSettingDefault(true)
    try {
      localStorage.setItem('cp_eq_user_default', JSON.stringify(parsed))
      if (fbReady && db.current) {
        await saveSettingsToFirebase(db.current, parsed)
      }
      toast('Set as school default.', 'success')
    } catch (e) {
      toast('Failed to set default.', 'error')
    }
    setSettingDefault(false)
  }

  function handleReset() {
    try {
      const raw = localStorage.getItem('cp_eq_user_default')
      if (raw) {
        const saved = JSON.parse(raw)
        setScores(saved.map(t => String(t.minScore)))
        toast('Reset to saved default.', 'success')
      } else {
        setScores(DEFAULT_EQ_SCALE.map(t => String(t.minScore)))
        toast('Reset to factory default.', 'success')
      }
    } catch (e) {
      setScores(DEFAULT_EQ_SCALE.map(t => String(t.minScore)))
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontSize: 12, color: 'var(--ink3)' }}>
        Set the minimum score (%) for each equivalency grade. Below the last tier = <strong>5.00 (Failed)</strong>.
      </div>

      {/* Input grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px 12px' }}>
        {EQ_LABELS.map((label, i) => (
          <div key={label}>
            <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 3, textAlign: 'center' }}>
              <strong>{label}</strong>
            </div>
            <input
              className="form-input"
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={scores[i]}
              onChange={e => handleChange(i, e.target.value)}
              style={{ textAlign: 'center', padding: '5px 4px' }}
            />
          </div>
        ))}
      </div>

      {/* Buttons */}
      <div className="flex gap-2 flex-wrap">
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Scale'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={handleSetDefault} disabled={settingDefault}>{settingDefault ? 'Saving…' : 'Set as Default'}</button>
        <button className="btn btn-ghost btn-sm" onClick={handleReset}>Reset to Default</button>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />

      {/* Live preview */}
      <div>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Preview</div>
        <div style={{ maxHeight: 260, overflowY: 'auto', borderRadius: 8, border: '1px solid var(--border)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600 }}>Equiv</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600 }}>Min Score</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600 }}>Letter</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600 }}>Remark</th>
              </tr>
            </thead>
            <tbody>
              {previewScale.map((tier, i) => {
                const info = gradeInfo(tier.minScore + 0.1, eqScale)
                return (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '5px 10px', fontWeight: 700 }}>{EQ_LABELS[i]}</td>
                    <td style={{ padding: '5px 10px' }}>≥ {tier.minScore}%</td>
                    <td style={{ padding: '5px 10px' }}>{info.ltr}</td>
                    <td style={{ padding: '5px 10px', color: info.rem === 'Passed' ? 'var(--green)' : info.rem === 'Failed' ? 'var(--red)' : 'var(--ink2)' }}>
                      {info.rem}
                    </td>
                  </tr>
                )
              })}
              <tr style={{ borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
                <td style={{ padding: '5px 10px', fontWeight: 700, color: 'var(--red)' }}>5.00</td>
                <td style={{ padding: '5px 10px' }}>Below {scores[scores.length - 1]}%</td>
                <td style={{ padding: '5px 10px' }}>F</td>
                <td style={{ padding: '5px 10px', color: 'var(--red)' }}>Failed</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Firebase Tab ─────────────────────────────────────────────────────────────
const FB_FIELDS = [
  { key: 'apiKey',            label: 'API Key',             placeholder: 'AIzaSy...' },
  { key: 'authDomain',        label: 'Auth Domain',         placeholder: 'your-app.firebaseapp.com' },
  { key: 'projectId',         label: 'Project ID',          placeholder: 'your-project-id' },
  { key: 'storageBucket',     label: 'Storage Bucket',      placeholder: 'your-app.appspot.com' },
  { key: 'messagingSenderId', label: 'Messaging Sender ID', placeholder: '123456789' },
  { key: 'appId',             label: 'App ID',              placeholder: '1:123:web:abc' },
]

function FirebaseTab() {
  const { fbReady, fbConfig, reinitFirebase } = useData()
  const { toast } = useUI()

  const envConfig = getFbConfigFromEnv()
  const usingEnv  = !!envConfig

  const [fields, setFields] = useState(() => ({
    apiKey:            fbConfig?.apiKey            || '',
    authDomain:        fbConfig?.authDomain        || '',
    projectId:         fbConfig?.projectId         || '',
    storageBucket:     fbConfig?.storageBucket     || '',
    messagingSenderId: fbConfig?.messagingSenderId || '',
    appId:             fbConfig?.appId             || '',
  }))
  const [saving, setSaving]   = useState(false)
  const [cleared, setCleared] = useState(false)

  function handleChange(key, val) {
    setFields(prev => ({ ...prev, [key]: val }))
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!fields.apiKey.trim() || !fields.projectId.trim()) {
      toast('API Key and Project ID are required.', 'warn'); return
    }
    setSaving(true)
    try {
      const cfg = {
        apiKey:            fields.apiKey.trim(),
        authDomain:        fields.authDomain.trim()        || fields.projectId.trim() + '.firebaseapp.com',
        projectId:         fields.projectId.trim(),
        storageBucket:     fields.storageBucket.trim()     || fields.projectId.trim() + '.appspot.com',
        messagingSenderId: fields.messagingSenderId.trim() || '',
        appId:             fields.appId.trim()             || '',
      }
      const enc = await encryptFbConfig(cfg)
      localStorage.setItem('cp_firebase_enc', enc)
      const ok = await reinitFirebase(cfg)
      toast(ok ? 'Firebase connected.' : 'Config saved but connection failed — check credentials.', ok ? 'success' : 'error')
      setCleared(false)
    } catch (err) {
      toast('Failed to save Firebase config.', 'error')
    }
    setSaving(false)
  }

  async function handleClear() {
    localStorage.removeItem('cp_firebase_enc')
    localStorage.removeItem('cp_firebase')
    setFields({ apiKey: '', authDomain: '', projectId: '', storageBucket: '', messagingSenderId: '', appId: '' })
    setCleared(true)
    toast('Firebase config cleared. Reload the page to disconnect.', 'success')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {usingEnv ? (
        /* ── Env-based config (read-only) ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--ink3)', background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px' }}>
            Firebase is configured via environment variables (<code>VITE_FB_*</code> in <code>.env</code>).
            The connection persists automatically for all users across sessions.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {FB_FIELDS.map(({ key, label }) => (
              <div key={key} className="flex gap-2" style={{ alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--ink3)', width: 140, flexShrink: 0 }}>{label}</span>
                <span style={{ fontSize: 12, color: 'var(--ink)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {key === 'apiKey' ? '••••••••••••••••' : (envConfig[key] || '—')}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* ── Manual config (no env vars set) ── */
        <>
          {!fbConfig && (
            <div style={{ fontSize: 12, color: 'var(--yellow)', background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px' }}>
              No <code>VITE_FB_*</code> env vars detected. Enter credentials below, or add them to your <code>.env</code> file for automatic persistent connection.
            </div>
          )}
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {FB_FIELDS.map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="form-label">{label}</label>
                <input
                  className="form-input"
                  value={fields[key]}
                  onChange={e => handleChange(key, e.target.value)}
                  placeholder={placeholder}
                  autoComplete="off"
                />
              </div>
            ))}
            <div className="flex gap-2" style={{ marginTop: 4 }}>
              <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>
                {saving ? 'Connecting…' : 'Save & Connect'}
              </button>
              {(fbReady || fbConfig) && (
                <button className="btn btn-ghost btn-sm" type="button" onClick={handleClear}>Clear Config</button>
              )}
            </div>
          </form>
        </>
      )}
    </div>
  )
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export default function AdminSettingsModal({ onClose }) {
  const [activeTab, setActiveTab] = useState('semester')

  return (
    <Modal onClose={onClose} size="lg">
      <ModalHeader title="Admin Settings" onClose={onClose} />

      {/* Tab bar */}
      <div className="flex gap-1 mb-5" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '7px 14px',
              fontSize: 13,
              fontWeight: activeTab === t.id ? 700 : 400,
              color: activeTab === t.id ? 'var(--accent)' : 'var(--ink2)',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              borderBottom: activeTab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              background: 'none',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'semester'  && <SemesterTab />}
      {activeTab === 'cred'     && <CredentialsTab />}
      {activeTab === 'eq'       && <EquivScaleTab />}
      {activeTab === 'firebase' && <FirebaseTab />}
    </Modal>
  )
}
