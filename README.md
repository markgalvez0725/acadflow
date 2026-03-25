# AcadFlow

**Academic Management System** for teachers and students — built with Next.js and Firebase.

---

## Overview

AcadFlow is a web-based academic portal that gives teachers and students a unified platform to manage grades, attendance, quizzes, and class activities in real time.

## Features

### Teacher Portal
- **Dashboard** — class-wide KPIs, quiz performance charts, at-risk student monitoring
- **Students** — full roster management with grades and attendance overview
- **Grades** — input and manage grades per subject and assessment type
- **Attendance** — calendar-based daily attendance tracking (Present / Absent / Excuse)
- **Quizzes** — create quizzes and view individual and class performance
- **Activities** — post assignments with deadlines and grade submissions
- **Messages** — one-on-one and broadcast announcements to students
- **Notifications** — system-wide alerts and activity updates

### Student Portal
- **Dashboard** — personal GWA, attendance rate, and recent activity
- **Grades** — view grades per subject with assessment breakdowns
- **Attendance** — personal attendance calendar and summary
- **Quizzes** — quiz history with scores and class comparison
- **Activities** — submit assignments via link
- **Messages** — direct messaging with teachers

### General
- Firebase Firestore real-time database
- EmailJS OTP verification for student registration and password reset
- Excel (.xlsx) and PDF export for grades and attendance
- Light and dark mode
- Mobile-responsive design

## Tech Stack

- **Framework** — Next.js 16 (App Router, TypeScript)
- **Styling** — Tailwind CSS v4
- **Database** — Firebase Firestore
- **Email** — EmailJS
- **Exports** — SheetJS (Excel), jsPDF + AutoTable (PDF)
- **Deployment** — Vercel

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Configuration

On first run, go to **Teacher Portal → Settings** to configure:

1. **Firebase** — paste your Firebase project config (Firestore must be enabled)
2. **EmailJS** — add your EmailJS public key, service ID, and template ID for OTP emails

## Deployment

Deployed on [Vercel](https://vercel.com). To redeploy:

```bash
vercel --prod
```

Live URL: [https://acadflow-seven.vercel.app](https://acadflow-seven.vercel.app)

---

## Credits

Built by **Mark Arnold Galvez**.
AI assistance provided by [Claude](https://claude.ai) (Anthropic) during development.
