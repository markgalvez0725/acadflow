// ── App version + changelog ────────────────────────────────────────────────
// Single source of truth for the version shown in the sidebars. Bump APP_VERSION
// and PREPEND a new entry to CHANGELOG (newest first) whenever a notable set of
// features ships, so the "What's new" modal always reflects the current build.
// User-facing copy: keep it plain, no em-dashes.

export const APP_VERSION = '2.1.0'

export const CHANGELOG = [
  {
    version: '2.1.0',
    date: 'June 2026',
    title: 'Emoji reactions in messages',
    changes: [
      'React to any message with an emoji, Telegram-style: tap the smiley to pick from a quick bar, or open the full set with the plus.',
      'Reaction counts sit under each bubble; your own reaction is highlighted, and tapping it again removes it.',
      'Works in direct chats and group chats, for both students and professors, and updates live as people react.',
      'Emojis use the Apple style so they look the same on every phone and computer.',
    ],
  },
  {
    version: '2.0.1',
    date: 'June 2026',
    title: 'Messaging and startup fixes',
    changes: [
      'Read receipts now reflect what was actually seen: the "seen" avatar only sits under a message once it has really been opened, and drops down live as new messages are read.',
      'Smoother startup: the loading screen no longer flashes twice before the app opens.',
      'Cleaner inbox: long names wrap neatly, conversations load as you scroll, and deleting a chat asks you to confirm.',
      'More reliable profile photo verification.',
    ],
  },
  {
    version: '2.0',
    date: 'June 2026',
    title: 'Messaging, enrollment, and profile polish',
    changes: [
      'Messages now show Messenger-style "seen" avatars, and group chats send faster.',
      'Edit or delete your own messages (delete just for you, or for everyone).',
      'Inbox previews show the latest message in every conversation.',
      'Regular vs irregular students: irregular students can enroll in subjects across any year level.',
      'Profile photos now appear across the app wherever a student is shown.',
    ],
  },
  {
    version: '1.5',
    date: 'May 2026',
    title: 'Instagram-style Stream',
    changes: [
      'Stream rebuilt as an Instagram-style feed that loads on scroll (no pagination).',
      'Like and save posts, full-screen media lightbox, inline comments, replies, and @mentions.',
      'Paste a Google Drive link to attach files to a post.',
    ],
  },
  {
    version: '1.0',
    date: 'Earlier releases',
    title: 'Core school portal',
    changes: [
      'Grades, attendance, activities, quizzes, online classes, and announcements.',
      'Face ID verification and self-service password reset.',
      'Guided account verification for new students.',
    ],
  },
]
