# AcadFlow Custom Agents, Hooks & Skills

This directory contains project-specific customizations for GitHub Copilot and Claude Code to optimize development workflows for AcadFlow.

## 📁 Structure

```
.agents/
├── agents/           # Custom agents for specialized tasks
├── hooks/            # Pre-commit validation hooks
├── skills/           # Reusable skills for common workflows
└── README.md         # This file
```

## 🛡️ security-auditor Agent

**Location:** `agents/security-auditor.agent.md`

A security-focused agent specialized in finding vulnerabilities in AcadFlow code.

### What It Audits
- **XSS Vulnerabilities** — Unsanitized HTML rendering, missing DOMPurify checks
- **Firebase Issues** — Race conditions, weak write patterns, plaintext secrets
- **Auth Flaws** — Weak lockout, missing role validation, unscoped queries
- **Input Validation** — Missing validation on student IDs, emails, unbounded strings

### Usage
```
@security-auditor audit StreamTab.jsx for XSS vulnerabilities
@security-auditor check fbAddAnnouncementComment for race conditions
@security-auditor review UserInput component for injection attacks
```

### Key Patterns It Knows
- ✅ DOMPurify sanitization with allowed tag whitelist
- ✅ Firebase transactions for atomic multi-step writes
- ✅ SHA-256 hashing for passwords
- ✅ AES encryption for sensitive config
- ✅ Role-based access control in components

---

## 🔒 security-enforcement Hook

**Location:** `hooks/security-enforcement.hook.md`

Pre-commit validation that catches common security mistakes **before code is committed**.

### What It Catches
- `dangerouslySetInnerHTML` without DOMPurify
- Firebase read-modify-write patterns (suggests transactions)
- Plaintext Firebase config or passwords
- Direct Firestore imports in components (suggests DataContext)
- Missing input validation
- Hardcoded secrets

### Behavior
- ❌ **Blocks** high-risk patterns with explanation
- ⚠️ **Warns** on medium-risk patterns
- ✅ **Approves** security-positive patterns (DOMPurify imports, transactions, encryption)
- 🔧 Provides fix suggestions and learning resources

### Example Output
```
❌ Security issue detected:
   File: StreamTab.jsx, Line 245
   Pattern: dangerouslySetInnerHTML without DOMPurify
   Risk: XSS vulnerability if content is user-controlled
   
   Fix: Import DOMPurify and wrap your content:
   ✅ <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }} />
```

---

## 🔧 refactor-streamtab Skill

**Location:** `skills/refactor-streamtab/SKILL.md`

Guidance for extracting large nested components from `StreamTab.jsx` into separate, maintainable files.

### What It Guides
Extracts the 1000+ line monolithic component into 4 focused files:
- `RichTextEditor.jsx` (~70 lines) — HTML editor with sanitization
- `CommentsSection.jsx` (~120 lines) — Comments and replies
- `AnnouncementFormModal.jsx` (~80 lines) — Create/edit modal
- `StreamTab.jsx` (~50 lines) — Main orchestrator

### Benefits
✅ Improved testability and reusability  
✅ Clearer code navigation and responsibility  
✅ Easier to audit security (sanitization is visible)  
✅ Potential reuse in other tabs (e.g., Messages, Activities)  
✅ Smaller diffs for git history

### Usage
```
Use this skill to guide component extraction following the checklist and patterns provided.
Manual execution recommended to preserve all functionality and security measures.
```

---

## 🚀 How to Use

### Using the Security Auditor Agent
1. In your IDE (VSCode with Copilot extension), open a code file or PR
2. Invoke with: `@security-auditor [your question]`
3. Examples:
   - "Audit this component for XSS"
   - "Check if this Firebase write is atomic"
   - "Review role-based access in this query"

### Using the Security Enforcement Hook
1. Hook runs automatically on `PreToolUse` for file edits
2. If it detects issues, it will block and provide guidance
3. To override: Use `--force` flag (if implemented)
4. To disable: Configure hook settings in your local agent config

### Using the Refactor Skill
1. Review the checklist in `skills/refactor-streamtab/SKILL.md`
2. Manually extract components following the provided patterns
3. Test in dev mode: `npm run dev`
4. Verify all features work (create, edit, comment, reply)
5. Run build: `npm run build`

---

## 📚 Context & References

For additional context, see:
- **CLAUDE.md** — Main agent guide (stack, patterns, security)
- **README.md** — Project overview and features
- **src/components/admin/tabs/StreamTab.jsx** — Current implementation
- **src/firebase/persistence.js** — Firebase write patterns (transactional examples)
- **src/utils/crypto.js** — Encryption and hashing utilities

---

## ✏️ Customization

Each file can be edited to add new patterns or adjust behavior:

1. **Agent:** Add new sections to `agents/security-auditor.agent.md` to expand audit scope
2. **Hook:** Extend pattern arrays in `hooks/security-enforcement.hook.md` to catch new vulnerabilities
3. **Skill:** Update checklist in `skills/refactor-streamtab/SKILL.md` with new dependencies

---

## 🤝 Contributing

When adding new security patterns or refactoring guidance:
1. Document the pattern clearly
2. Provide code examples (before/after)
3. Link to relevant utilities (e.g., `sanitizeHtml`, `runTransaction`)
4. Update this README if adding new files

---

**Created:** April 3, 2026  
**Last Updated:** April 3, 2026
