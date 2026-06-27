// On-device "Smart write" for announcements. Deterministic and dependency-free:
// it turns the structured fields the professor already filled in (type, class,
// subject, topics, meeting link) into a clean, polite message. No paid API and
// no network - the same on-device Smart pattern used across AcadFlow.

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]))
}

// Cheap deterministic pick: the same inputs always read the same, but different
// classes/subjects get slightly different phrasing so it never feels canned.
function pick(arr, seed) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return arr[h % arr.length]
}

export function composeAnnouncementMessage({ type, classLabel = '', subject = '', topics = [], meetingLink = '', referenceVideo = '' } = {}) {
  const who = subject || classLabel || 'class'
  const seed = `${type}|${classLabel}|${subject}`

  if (type === 'no_class') {
    const open = pick([
      `Please be advised that there will be no ${who} session for our next meeting.`,
      `Kindly note that our upcoming ${who} class is suspended.`,
      `There will be no class for ${who} on our next scheduled meeting.`,
    ], seed)
    return `<p>${esc(open)}</p><p>Please use the time to review our previous lessons and keep an eye on the stream for any follow-up activities. Thank you, and see you next session.</p>`
  }

  if (type === 'online_class') {
    const open = pick([
      `Our ${who} session will be held online for our next meeting.`,
      `We'll be meeting online for ${who} on our next class.`,
      `${who} will proceed online this time.`,
    ], seed)
    const link = meetingLink
      ? `<p>Join here: <a href="${esc(meetingLink)}">${esc(meetingLink)}</a></p>`
      : `<p>The meeting link is attached below. Please join a few minutes early.</p>`
    return `<p>${esc(open)}</p>${link}<p>Make sure you have a stable connection and your camera ready. See you online.</p>`
  }

  if (type === 'meeting_topics') {
    const list = (topics || []).map(t => t && t.trim()).filter(Boolean)
    const open = pick([
      `Here are the lesson topics we'll cover in our next ${who} session:`,
      `For our upcoming ${who} class, we'll go through the following lesson topics:`,
      `In our next ${who} meeting, please be ready for these lesson topics:`,
    ], seed)
    const ul = list.length ? `<ul>${list.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''
    return `<p>${esc(open)}</p>${ul}<p>Please review any related materials beforehand so we can make the most of our time together.</p>`
  }

  if (type === 'resource_hub') {
    const open = pick([
      `I've gathered some resources for our ${who} class to help you study.`,
      `Here are the learning resources for ${who}.`,
      `Sharing a few materials for ${who} that should help with our lessons.`,
    ], seed)
    const vid = referenceVideo
      ? `<p>Reference video: <a href="${esc(referenceVideo)}">${esc(referenceVideo)}</a></p>`
      : ''
    return `<p>${esc(open)}</p>${vid}<p>The files are attached below. You can preview each one or download it for offline study. Let me know if anything does not open.</p>`
  }

  return `<p>Please check the details for our next ${esc(who)} session.</p>`
}
