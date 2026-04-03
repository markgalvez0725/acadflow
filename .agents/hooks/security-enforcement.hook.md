---
name: security-enforcement
description: Pre-commit hook that validates code changes for common AcadFlow security patterns—catches unsanitized HTML, weak Firebase patterns, and plaintext secrets.
hooks:
  - PreToolUse
---

# AcadFlow Security Enforcement Hook

This hook validates code changes **before they're committed** to catch common security mistakes in AcadFlow.

## What It Checks

### 🔴 Block on High-Risk Patterns

1. **Unsanitized HTML rendering**
   - Flags `dangerouslySetInnerHTML` without a DOMPurify call in the same expression
   - Suggests wrapping with `sanitizeHtml()` helper
   - Example: ❌ `<div dangerouslySetInnerHTML={{ __html: userContent }} />` (blocks)
   - Example: ✅ `<div dangerouslySetInnerHTML={{ __html: sanitizeHtml(userContent) }} />` (passes)

2. **Weak Firebase patterns**
   - Detects `getDoc()` followed by `setDoc()` in same function (suggests transaction)
   - Flags Firebase writes outside `fbWithTimeout()` wrapper
   - Detects direct Firestore imports in components (should use DataContext)

3. **Plaintext secrets**
   - Flags passwords or tokens in code
   - Detects base64-encoded credentials (suggests encryption instead)
   - Warns if Firebase config appears in components

4. **Missing input validation**
   - Flags form submissions without `.trim()` or length checks
   - Detects `parseInt()` without validation on student IDs
   - Warns about missing max-length on user input fields

### ⚠️ Warn on Medium-Risk Patterns

- `useState` with sensitive data (suggest moving to encrypted storage)
- `console.log` of user PII
- Missing error boundaries around user input handling
- Hardcoded role checks (suggest using auth context)

### ✅ Enforce on Security-Positive Patterns

- Imports of `DOMPurify`, `uuid`, `hashPassword` (good signs)
- Use of `runTransaction` in Firebase operations
- Encryption functions for config storage
- Role-based conditional rendering

## Hook Behavior

The hook runs on `PreToolUse` for file edits. If it detects blocking issues:
1. **Blocks the edit** with explanation of the risk
2. **Provides a fix** (code example or suggestion)
3. **Explains why** (educational, not just restrictive)

Users can override with `--force` if they understand the risk.

## Example Scenarios

### Scenario 1: Attempting to render HTML without sanitization

```
USER: Add HTML rendering for announcement content
HOOK DETECTS: dangerouslySetInnerHTML without DOMPurify

OUTPUT:
❌ Security issue detected:
   File: StreamTab.jsx, Line 245
   Pattern: dangerouslySetInnerHTML without DOMPurify
   Risk: XSS vulnerability if content is user-controlled
   
   Fix: Import DOMPurify and wrap your content:
   ✅ <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }} />
   
   Learn more: See CLAUDE.md "Recent Security Hardening" section
```

### Scenario 2: Attempting read-modify-write Firebase pattern

```
USER: Add comment to announcement
HOOK DETECTS: getDoc → local modification → setDoc pattern

OUTPUT:
⚠️ Concurrency issue detected:
   File: persistence.js, Lines 142-156
   Pattern: Read-modify-write without transaction
   Risk: Lost updates if multiple clients edit concurrently
   
   Recommendation: Use Firebase transactions (runTransaction)
   See fbAddAnnouncementComment() at line 133 for example
```

### Scenario 3: Committing code with DOMPurify

```
USER: Add sanitized comment rendering
HOOK DETECTS: import DOMPurify, sanitizeHtml() calls

OUTPUT:
✅ Security pattern detected: XSS sanitization enabled
   - DOMPurify is imported
   - HTML whitelist is configured
   - dangerouslySetInnerHTML is wrapped

Continue? (Y/n)
```

## Configuration

Hook is pre-configured for AcadFlow patterns. To adjust:
- Edit this file and update the pattern arrays
- Patterns are regex for `grep` compatibility
- Add new checks by extending the PATTERNS section

## Rules Per File Type

### `.jsx` / `.js` Components
- Check for dangerouslySetInnerHTML usage
- Validate DOMPurify imports
- Check for direct Firestore reads

### `firebase/persistence.js`
- Enforce transactions on multi-step writes
- Validate fbWithTimeout wrapper
- Check for role-based scoping

### `utils/validate.js` / `crypto.js`
- Encourage security-positive patterns
- Warn if exported helpers aren't used

### `.env` and config
- Block committed plaintext Firebase config
- Flag unencrypted credentials
- Suggest encryption via settings.js
