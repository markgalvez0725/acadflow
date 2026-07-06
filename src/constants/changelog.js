// ── App version + changelog ────────────────────────────────────────────────
// Single source of truth for the version shown in the sidebars. Bump APP_VERSION
// and PREPEND a new entry to CHANGELOG (newest first) whenever a notable set of
// features ships, so the "What's new" modal always reflects the current build.
// User-facing copy: keep it plain, no em-dashes.

export const APP_VERSION = '2.8.0'

export const CHANGELOG = [
  {
    version: '2.8.0',
    date: 'July 2026',
    title: 'Quota-proof classes and a live pulse of the portal',
    changes: [
      'Live classes moved their real-time chatter (joins, presence heartbeats, connection handshakes, in-call chat, polls, and the question queue) onto the Firebase Realtime Database, which is free for exactly this kind of traffic. A full class hour no longer eats into the daily database quota, so mid-class "quota exceeded" freezes are gone.',
      'The switch is automatic and safe: when a class goes live the app quietly tests the new database first and every student locks to the same path. If it is ever unreachable, the class runs the old way instead, and older meetings are untouched.',
      'Big background savings across the whole app: meeting presence updates are six times lighter, student devices no longer live-stream the entire roster (they keep a live line only on their own record and refresh the class list at most once a day), and telemetry writes are batched further apart.',
      'System Reports gained a Who\'s online card: see who is in the portal right now with profile avatars, and hover a person to see their recent activity trail - sign-ins, tab visits, submissions, quiz takes, class joins and leaves, messages. It refreshes on its own while the tab is open.',
      'Class rooms heal harder: room listeners re-attach themselves after a network drop instead of going silent, and the student roster fetch retries automatically when the connection comes back.',
    ],
  },
  {
    version: '2.7.0',
    date: 'July 2026',
    title: 'The classroom toolkit: whiteboard, polls, questions, and data saver',
    changes: [
      'Professors got a whiteboard: draw with pen, shapes, and text, then present the board to the class in one tap, from any device including phones and tablets. Smooth ink, undo and redo, an eraser, colors and sizes, and a one-tap PNG download of the board.',
      'New tools inside the class: quick polls with live results (answers anonymous to classmates), a silent question queue where students ask without interrupting and +1 the questions they share, a class outline with resource links and timed agenda items, a shared countdown timer with a chime for everyone, a fair random student picker that never repeats until the whole class has a turn, and spotlight to feature one student on every screen.',
      'Data saver for mobile data: one toggle joins audio-first and stops incoming camera video entirely, while the presented screen or whiteboard keeps flowing. It is suggested automatically when your signal is weak and remembered on your device.',
      'Tap your connection dot for plain-language details: round trip, packet loss, route, and live data rates, with one practical tip. The dots themselves are now measurement-backed: no dot until there is a real reading, and a recovered connection turns green in seconds instead of staying red.',
      'Connection recovery got faster: switching between wifi and mobile data heals the class immediately instead of waiting out timers, and the Connection lost banner gained a Reconnect now button.',
      'Presenting and the whiteboard reach students with less delay in full rooms, and professor buttons like Go live, Start, and End class can no longer fire twice on a fast double tap.',
    ],
  },
  {
    version: '2.6.0',
    date: 'July 2026',
    title: 'Built for weak signal: classes and work that hold on',
    changes: [
      'Online classes now hold on through weak internet. Students on mobile data get a stronger connection path, short drops heal themselves in seconds, and the room never gives up on someone who is still in class - no more endless "Reconnecting" walls.',
      'The join setup screen now checks your connection first: a clear Good or Weak label before you commit. On a weak signal your camera starts off for a smoother, audio-first join (turn it back on anytime), and if joining ever stalls you get Retry and Close buttons instead of a stuck spinner.',
      'Your work survives bad signal: quiz submissions retry themselves and your answers stay saved on your device until they go through, activity files never have to upload twice after a failed save, and comments keep your typed text if posting fails so you can just try again.',
      'Fairer quiz grading: a taken quiz never counts below 50 in the grade computation, and past quizzes follow the new rule automatically.',
      'The app itself loads reliably on slow data: any screen that fails to load shows a Try again button and fixes itself the moment you are back online, instead of going blank.',
      'Also in this release: case study plans got a full project timeline with steps you can drag to reorder (dates re-schedule themselves), group task boards for members, and editing a message no longer fails on shaky connections.',
    ],
  },
  {
    version: '2.5.0',
    date: 'July 2026',
    title: 'Set up before you join, smart class notes, and hands-off attendance',
    changes: [
      'Joining a class now opens a setup screen first: preview your camera, pick your microphone and camera, and do a quick mic check before stepping in. Your choices are remembered on this device, and the professor enters with a Start class button while students can wait inside.',
      'Recordings now capture the class the way it happened: the presented screen plays beside a live strip of the class, profile photos stand in for cameras that are off, and reactions, raised hands, mutes, and who is speaking all show up in the video. Recordings can be watched right inside the app.',
      'After a recorded class, the professor can generate the transcript and Smart study notes on their own computer, private and free: clean sections with key terms and speaker names, in English and Tagalog alike, ready to share to the class Stream in one tap. The first run downloads a speech model once and reuses it after.',
      'Attendance takes care of itself: during class the People panel shows who is present, late, or not yet joined against the enrolled list, and ending the class opens a ready-made attendance sheet the professor can save in one tap.',
      'Professors got host controls: mute a student, mute everyone, or remove someone from the room. Connections heal themselves after wifi hiccups with honest reconnecting labels, a quality dot next to every person, and a warning pill when your own internet turns slow or unstable.',
      'Beyond classes: the Calendar was rebuilt on both sides with live classes synced in, and Case Studies lets professors grade grouped practical exams straight into the midterm and finals columns.',
    ],
  },
  {
    version: '2.4.0',
    date: 'July 2026',
    title: 'Online classes now run inside AcadFlow',
    changes: [
      'Start a class and everyone joins a live video room right inside the app, with no Google Meet link needed. Link-based meetings still work if you prefer them.',
      'The room works like Google Meet: a grid that fills the screen, raise hand with a chime, emoji reactions, join and leave sounds, and an in-call chat with sender photos. Chat messages are visible only to people in the call, are deleted when the class ends, and the professor can turn them off.',
      'Every camera fits its tile: portrait phones and laptops alike are shown whole on a soft gradient backdrop, never cropped or zoomed, and profile photos appear whenever a camera is off.',
      'Present your screen with one tap from a computer or Android phone. Presenting was tuned end to end for low delay: it uses hardware video encoding when your device has it, turns sharp within a second, and stays in sync through long presentations, repeated shares, and big rooms.',
      'Professors can record the class: it saves as an MP4 straight into Google Drive while the class runs, ready to share to the class in one tap, and plays on any device including iPhones.',
      'Switch tabs or apps during a class and the video pops into a small always-on-top window automatically (on supported browsers). Minimizing the room keeps a floating mini player inside the app, so the class is never out of sight.',
    ],
  },
  {
    version: '2.3.0',
    date: 'July 2026',
    title: 'Quiz drafts, live monitoring, and Smart Quiz',
    changes: [
      'Quizzes can now be saved as a draft and posted when you are ready. Drafts stay hidden from students and show a Draft badge with a one-tap Post, and a new Now button opens a quiz right away.',
      'Watch a quiz as it happens: the new Monitor (which replaces View) shows who has not started, who is in progress, who is almost done, and who has submitted, updating live. Leaving the quiz now deducts 1% from the score each time, automatically.',
      'Smart Quiz turns a lesson or a topic into questions and opens them in Perplexity in one click, with no key or setup. You can also download a template for ChatGPT, Claude, or Gemini, and pick easy, medium, or hard.',
      'Keep me signed in keeps you logged in on your own device, so a quick browser refresh always loads the latest without retyping your password. Leave it off on shared or lab computers.',
      'Teachers can attach files to an activity, shown to students with the same inline preview and full-screen viewer used across the app. For group work, one representative uploads for the whole group and the upload locks once submitted so nobody overwrites it (teachers can reopen it).',
      'Smaller touches: the Grades quiz column now shows the running average of quiz results, and the Nudge all reminder only appears once an activity is past its deadline.',
    ],
  },
  {
    version: '2.2.0',
    date: 'July 2026',
    title: 'Cleaner, more consistent design',
    changes: [
      'Every tab now opens with a clear title header, and the whole app shares one consistent look on phone, tablet, and computer.',
      'Pop-up windows were redesigned to match: a tidy title at the top, content that scrolls in the middle, and the action buttons pinned at the bottom. On phones they now slide up as a full-screen sheet that is easier to reach.',
      'Group activities get a dedicated "Set up groups" tool: choose how many students per group, auto-form balanced teams, or build your own, with clear Alpha, Bravo, Charlie names. You can also paste a grouping straight from Excel.',
      'Smaller polish: consistent calendar and control buttons, and status colors in the Stream now read clearly in dark mode.',
    ],
  },
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
