# Student Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-row "Reset Password" action in the Students tab that generates a random password, shows it in a modal with a copy button, and saves the hashed password to Firestore with `_tempPass: true`.

**Architecture:** A `generateRandomPassword()` utility is added to `src/utils/crypto.js`. A new `ResetPasswordModal` component is added inside `StudentsTab.jsx`. A key-icon button is added to each registered student's action cell that opens the modal.

**Tech Stack:** React 19, Tailwind CSS v4, Firebase Firestore (via `saveStudents`), Web Crypto API (`crypto.getRandomValues`).

---

### Task 1: Add `generateRandomPassword` to crypto utils

**Files:**
- Modify: `src/utils/crypto.js`

- [ ] **Step 1: Add the function at the bottom of `src/utils/crypto.js`**

Append this export after the last function in the file:

```js
// ── Random password generator ─────────────────────────────────────────────
export function generateRandomPassword() {
  const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower   = 'abcdefghjkmnpqrstuvwxyz'
  const digits  = '23456789'
  const symbols = '!@#$%^&*'
  const all     = upper + lower + digits + symbols

  const rand = (charset) => charset[crypto.getRandomValues(new Uint8Array(1))[0] % charset.length]

  // Guarantee at least one of each required character type
  const required = [rand(upper), rand(lower), rand(digits), rand(symbols)]

  // Fill remaining 4 characters from full set
  const extra = Array.from({ length: 4 }, () => rand(all))

  // Fisher-Yates shuffle so required chars aren't always at fixed positions
  const chars = [...required, ...extra]
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint8Array(1))[0] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
```

- [ ] **Step 2: Verify the file still has no syntax errors**

```bash
node --input-type=module <<'EOF'
import { readFileSync } from 'fs'
console.log('crypto.js length:', readFileSync('src/utils/crypto.js').length)
EOF
```

Expected: prints a byte count with no error.

- [ ] **Step 3: Commit**

```bash
git add src/utils/crypto.js
git commit -m "feat: add generateRandomPassword utility to crypto.js"
```

---

### Task 2: Add `ResetPasswordModal` and wire up the row action button

**Files:**
- Modify: `src/components/admin/tabs/StudentsTab.jsx`

- [ ] **Step 1: Add the import for `generateRandomPassword` and `KeyRound` icon**

At the top of `StudentsTab.jsx`, the existing import line is:
```js
import { hashPassword } from '@/utils/crypto'
```
Change it to:
```js
import { hashPassword, generateRandomPassword } from '@/utils/crypto'
```

Also add `KeyRound` to the existing lucide-react import line:
```js
import { Download, Upload, FileDown, KeyRound } from 'lucide-react'
```

- [ ] **Step 2: Add `ResetPasswordModal` component**

Insert the following component in `StudentsTab.jsx` immediately before the `// ── CSV helpers` comment (around line 341):

```jsx
// ── Reset Password Modal ──────────────────────────────────────────────
function ResetPasswordModal({ student, onClose }) {
  const { students, saveStudents } = useData()
  const { toast } = useUI()

  const [password]      = useState(() => generateRandomPassword())
  const [copied, setCopied]   = useState(false)
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState('')

  async function handleReset() {
    setSaving(true)
    setErr('')
    try {
      const hashed = await hashPassword(password)
      const updated = students.map(s =>
        s.id !== student.id
          ? s
          : { ...s, account: { ...s.account, pass: hashed, _tempPass: true } }
      )
      await saveStudents(updated, [student.id])
      toast('Password reset! Share the new password with the student.', 'green')
      onClose()
    } catch (e) {
      setErr('Failed to reset password: ' + e.message)
      setSaving(false)
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(password).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Modal onClose={onClose} maxWidth={420}>
      <h3>🔑 Reset Password</h3>
      <p className="modal-sub">
        A new random password has been generated for <strong>{student.name}</strong>.
        The student will be required to change it on next login.
      </p>

      {err && <div className="err-msg mb-3">{err}</div>}

      <div className="field mb-4">
        <label>Generated Password</label>
        <div className="flex items-center gap-2">
          <code
            className="flex-1 font-mono text-base bg-bg border border-border rounded-lg px-3 py-2 select-all tracking-widest"
            style={{ letterSpacing: '0.1em' }}
          >
            {password}
          </code>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleCopy}
            title="Copy to clipboard"
            style={{ flexShrink: 0 }}
          >
            {copied ? '✓ Copied' : '📋 Copy'}
          </button>
        </div>
        <div className="text-xs text-ink3 mt-1">
          Copy this password and share it with the student before confirming.
        </div>
      </div>

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn btn-primary" onClick={handleReset} disabled={saving}>
          {saving ? 'Resetting…' : 'Confirm Reset'}
        </button>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 3: Add `resetStudent` state to `StudentsTab`**

In the `StudentsTab` component, find the existing state declarations block (around line 531–534):
```js
const [showAdd, setShowAdd]             = useState(false)
const [showImport, setShowImport]       = useState(false)
const [editStudent, setEditStudent]     = useState(null)
const [exportStudent, setExportStudent] = useState(null)
```
Add one more line:
```js
const [resetStudent, setResetStudent]   = useState(null)
```

- [ ] **Step 4: Add the reset button to each student row's action cell**

Find the action cell in the table row (around line 703–714):
```jsx
<div className="stu-actions-cell">
  <button className="btn btn-ghost btn-sm" onClick={() => setEditStudent(s)} title="Edit">
    ...Edit
  </button>
  <button className="btn btn-ghost btn-sm" onClick={() => setExportStudent(s)} title="Export student report">
    <FileDown size={13} />
  </button>
  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(s)} title="Delete">
    ...
  </button>
</div>
```
Insert a reset button between the Edit button and the Export button:
```jsx
{s.account?.registered && (
  <button
    className="btn btn-ghost btn-sm"
    onClick={() => setResetStudent(s)}
    title="Reset password"
  >
    <KeyRound size={13} />
  </button>
)}
```

- [ ] **Step 5: Mount `ResetPasswordModal` in the Modals section**

Find the modals section at the bottom of `StudentsTab` (around line 728–740):
```jsx
{showAdd      && <AddStudentModal onClose={() => setShowAdd(false)} />}
{showImport   && <ImportStudentsModal onClose={() => setShowImport(false)} />}
{editStudent  && <EditStudentModal student={editStudent} onClose={() => setEditStudent(null)} />}
```
Add after the `editStudent` line:
```jsx
{resetStudent && <ResetPasswordModal student={resetStudent} onClose={() => setResetStudent(null)} />}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/tabs/StudentsTab.jsx
git commit -m "feat: add reset password action to student roster rows"
```

---

### Task 3: Verify in browser and push

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Manual verification checklist**

Open `http://localhost:5173` and log in as admin. Go to Students tab.

- [ ] A key icon button appears for each student that has a registered account
- [ ] Clicking the key icon opens the Reset Password modal showing the student's name
- [ ] The generated password is 8 characters with mixed case, digit, and symbol
- [ ] "Copy" button copies the password to clipboard and shows "✓ Copied" briefly
- [ ] "Cancel" closes the modal without changing anything
- [ ] "Confirm Reset" saves and closes — subsequent login with the new password works and student is prompted to change it
- [ ] Students with no account (`No Account` badge) do NOT show the key icon

- [ ] **Step 3: Push**

```bash
git push
```
