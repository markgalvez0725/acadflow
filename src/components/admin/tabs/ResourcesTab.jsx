import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import PageHeader from '@/components/ds/PageHeader'
import { Library, Plus, Trash2, ExternalLink } from 'lucide-react'
import { RESOURCE_TYPES, resourceType } from '@/utils/resourceTypes'

export default function ResourcesTab() {
  const { classes, resources, saveResource, deleteResource } = useData()
  const { toast } = useUI()

  const activeClasses = useMemo(() => classes.filter(c => !c.archived), [classes])

  const [classId, setClassId] = useState('')
  const [subject, setSubject] = useState('')

  // Effective selection (default to the first class/subject until the user picks).
  const cid = classId || activeClasses[0]?.id || ''
  const selectedClass = activeClasses.find(c => c.id === cid)
  const subjects = selectedClass?.subjects || []
  const sub = subject || subjects[0] || ''

  // Add form
  const [title, setTitle] = useState('')
  const [type, setType] = useState('module')
  const [url, setUrl] = useState('')
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmId, setConfirmId] = useState(null)

  const list = useMemo(
    () => resources
      .filter(r => r.classId === cid && r.subject === sub)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [resources, cid, sub]
  )

  async function handleAdd(e) {
    e.preventDefault()
    if (!cid || !sub) { toast('Pick a class and subject first.', 'warn'); return }
    if (!title.trim()) { toast('Please enter a title.', 'warn'); return }
    if (!/^https?:\/\/.+/.test(url.trim())) { toast('Enter a valid link starting with http:// or https://', 'warn'); return }
    setSaving(true)
    try {
      await saveResource({
        id: 'res_' + Date.now() + Math.random().toString(36).slice(2, 6),
        classId: cid,
        subject: sub,
        title: title.trim(),
        type,
        url: url.trim(),
        description: desc.trim(),
        createdAt: Date.now(),
      })
      setTitle(''); setUrl(''); setDesc(''); setType('module')
      toast('Resource added.', 'success')
    } catch (err) {
      toast('Failed to add resource: ' + (err?.message || 'unknown error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    try {
      await deleteResource(id)
      setConfirmId(null)
      toast('Resource removed.', 'success')
    } catch (err) {
      toast('Failed to remove: ' + (err?.message || 'unknown error'), 'error')
    }
  }

  return (
    <div>
      <PageHeader
        crumb={<><Library size={13} /> Academic <span>›</span> Resources</>}
        title="Resource Hub"
        subtitle="Share modules, slides, videos, and links — organized per class and subject"
      />

      {/* Class + subject pickers */}
      <div className="res-pickers">
        <div className="field-float field-float--select">
          <select value={cid} onChange={e => { setClassId(e.target.value); setSubject('') }}>
            {activeClasses.length === 0 && <option value="">No classes yet</option>}
            {activeClasses.map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.section ? ` · ${c.section}` : ''}</option>
            ))}
          </select>
          <label>Class</label>
        </div>
        <div className="field-float field-float--select">
          <select value={sub} onChange={e => setSubject(e.target.value)}>
            {subjects.length === 0 && <option value="">No subjects</option>}
            {subjects.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <label>Subject</label>
        </div>
      </div>

      {/* Add form */}
      {cid && sub && (
        <form className="card card-pad res-add" onSubmit={handleAdd}>
          <div className="res-add-row">
            <div className="field-float" style={{ flex: 2, marginBottom: 0 }}>
              <input type="text" placeholder=" " value={title} onChange={e => setTitle(e.target.value)} />
              <label>Title</label>
            </div>
            <div className="field-float field-float--select" style={{ flex: 1, marginBottom: 0 }}>
              <select value={type} onChange={e => setType(e.target.value)}>
                {RESOURCE_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <label>Type</label>
            </div>
          </div>
          <div className="field-float" style={{ marginBottom: 0 }}>
            <input type="url" placeholder=" " value={url} onChange={e => setUrl(e.target.value)} />
            <label>Link (https://…)</label>
          </div>
          <div className="field-float" style={{ marginBottom: 0 }}>
            <input type="text" placeholder=" " value={desc} onChange={e => setDesc(e.target.value)} />
            <label>Description (optional)</label>
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving} style={{ alignSelf: 'flex-start' }}>
            <Plus size={16} /> {saving ? 'Adding…' : 'Add resource'}
          </button>
        </form>
      )}

      {/* List */}
      {!list.length ? (
        <div className="empty" style={{ marginTop: 16 }}>
          <div className="empty-icon"><Library size={40} /></div>
          No resources for {sub || 'this subject'} yet. Add the first one above.
        </div>
      ) : (
        <div className="res-list" style={{ marginTop: 16 }}>
          {list.map(r => {
            const { Icon, label } = resourceType(r.type)
            return (
              <div key={r.id} className="res-item">
                <span className="res-ic" aria-hidden="true"><Icon size={18} /></span>
                <div className="res-main">
                  <div className="res-title">{r.title}</div>
                  <div className="res-meta">
                    <span className="badge badge-blue">{label}</span>
                    {r.description && <span className="res-desc">{r.description}</span>}
                  </div>
                </div>
                <div className="res-actions">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="btn btn-sm" title="Open link">
                    <ExternalLink size={15} />
                  </a>
                  {confirmId === r.id ? (
                    <>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDelete(r.id)}>Delete</button>
                      <button type="button" className="btn btn-sm" onClick={() => setConfirmId(null)}>Cancel</button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-sm" title="Remove" onClick={() => setConfirmId(r.id)}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
