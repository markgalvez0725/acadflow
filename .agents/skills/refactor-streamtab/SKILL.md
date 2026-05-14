---
name: refactor-streamtab
description: Refactoring skill to extract large nested components from StreamTab.jsx into separate, maintainable files. Handles RichTextEditor, CommentsSection, and AnnouncementFormModal with proper prop drilling and state management.
---

# Refactor StreamTab Components

This skill extracts the large nested components from `StreamTab.jsx` into separate, testable files while maintaining all functionality and prop drilling.

## What This Skill Does

Breaks down a monolithic 1000+ line component into focused, single-responsibility modules:

```
StreamTab.jsx (main container, ~50 lines)
├── RichTextEditor.jsx (HTML editor, ~70 lines)
├── CommentsSection.jsx (Comments + replies, ~120 lines)
└── AnnouncementFormModal.jsx (Create/edit modal, ~80 lines)
```

## Current State (Before)

**File:** `src/components/admin/tabs/StreamTab.jsx`
- **Lines:** 1000+
- **Nested components:** 3 (RichTextEditor, CommentsSection, AnnouncementFormModal)
- **Problem:** Hard to test, navigate, reuse, or modify individual features
- **Prop complexity:** 20+ props cascaded through nesting

## Target State (After)

**Directory:** `src/components/admin/tabs/stream/`
```
stream/
├── StreamTab.jsx           # Main component, orchestrates sub-components
├── RichTextEditor.jsx      # Isolated editor with sanitization
├── CommentsSection.jsx     # Comments/replies with interactions
└── AnnouncementFormModal.jsx # Create/edit modal with form logic
```

Each file is ~70-120 lines, with clear exports and contracts.

## Refactoring Checklist

- [ ] Create `src/components/admin/tabs/stream/` directory
- [ ] Extract `RichTextEditor` → `RichTextEditor.jsx`
  - [ ] Validate all sanitization logic is intact
  - [ ] Export as named export
  - [ ] Verify props: `content`, `onChange`, `onExec` (bold, italic, etc.)
- [ ] Extract `CommentsSection` → `CommentsSection.jsx`
  - [ ] Keep all comment/reply interaction logic
  - [ ] Export as named export
  - [ ] Verify props: `comments`, `onAddComment`, `onAddReply`, `onDeleteComment`
- [ ] Extract `AnnouncementFormModal` → `AnnouncementFormModal.jsx`
  - [ ] Keep modal state and form handling
  - [ ] Export as named export
  - [ ] Verify props: `isOpen`, `onClose`, `onSubmit`, `initialData` (for edit mode)
- [ ] Update `StreamTab.jsx` to import and compose
  - [ ] Remove nested function definitions
  - [ ] Keep all state at StreamTab level (single source of truth)
  - [ ] Verify no logic is lost
- [ ] Test in dev mode:
  - [ ] Create announcement
  - [ ] Edit announcement
  - [ ] Add comment with HTML formatting
  - [ ] Add reply to comment
  - [ ] Delete comment/reply
- [ ] Verify security:
  - [ ] DOMPurify still applied to HTML
  - [ ] UUIDs still generated for comment IDs
  - [ ] Sanitization config still in place
- [ ] Update imports in `AdminLayout.jsx` (if needed)
  - [ ] Verify no breaking changes to export path

## Extraction Pattern

### Example: RichTextEditor

**Before (nested in StreamTab.jsx):**
```jsx
const RichTextEditor = ({ content, onChange }) => {
  const sanitizeHtml = (html) => { ... };
  const handleExec = (cmd) => { ... };
  return <div>...</div>;
};
```

**After (standalone `RichTextEditor.jsx`):**
```jsx
import DOMPurify from 'dompurify';

export const RichTextEditor = ({ content, onChange, onExec }) => {
  const handleExec = (cmd) => { ... };
  return <div>...</div>;
};

// Export config if needed by other components
export const SANITIZE_CONFIG = { ... };
export const sanitizeHtml = (html) => { ... };
```

### Prop Drilling Contract

All extracted components follow this pattern:

**Input Props (readonly):**
```js
{
  // Data
  comments: Array,
  editingId: String,
  
  // Callbacks
  onAddComment: Function,
  onDelete: Function,
  
  // Config
  isReadOnly: Boolean
}
```

**Output (via callbacks):**
- No direct state mutations
- All updates go through parent callbacks
- Parent (StreamTab) holds all state

## Benefits After Refactoring

✅ **Testability** — Each component can be unit tested in isolation
✅ **Reusability** — CommentsSection could be used in StudentLayout
✅ **Navigation** — Easier to find code (you know which file to edit)
✅ **Performance** — Smaller files = faster IDE indexing
✅ **Maintainability** — Clear component contracts and responsibilities
✅ **Security** — Sanitization logic is visible and auditable
✅ **Git history** — Smaller, focused commits when updating features

## Potential Reuse

After refactoring, these components can be leveraged elsewhere:

- **RichTextEditor** → Messages tab (rich text in DMs)
- **CommentsSection** → Activities tab (comments on submissions)
- **AnnouncementFormModal** → Settings (create broadcast messages)

## Tools & Resources

- Use this skill's `/refactor-streamtab` command to guide the extraction
- Refer to `CLAUDE.md` "Adding Features" section for component placement
- Security rules: See `CLAUDE.md` "Recent Security Hardening" section
- Test locally: `npm run dev` and manually verify all features work

## Common Pitfalls to Avoid

❌ **Don't** extract without moving state to parent
❌ **Don't** duplicate sanitization logic across files
❌ **Don't** forget to update imports in AdminLayout
❌ **Don't** split state — keep single source of truth in StreamTab
❌ **Don't** inline large components without clear contracts

## Success Criteria

✅ All tests pass (if any exist)
✅ Dev mode runs without errors
✅ All CRUD operations work (create, read, update, delete announcements)
✅ Comments and replies still function
✅ HTML sanitization still applied
✅ Build succeeds: `npm run build`
✅ No console errors or warnings related to missing props
