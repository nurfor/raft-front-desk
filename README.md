# RAFT Front Desk

A static, single-page front-desk site for Richmond Area Family Therapy. It uses the existing `raft` schema through `supabase-js`; it does not create tables, change schema, or store application records anywhere else.

## Class assignment notes

- **AI tool:** OpenAI Codex.
- **First prompt:** Used the assignment brief in chat, filled with the provided Supabase project URL, publishable key, and RAFT table definitions.
- **What needed correction:** The first Home version showed only future appointments, so Holly's 2024 sample data would make the list look empty. The first Dashboard also measured the current calendar month, which could show no sample activity. Both now use the newest available appointment records/month as a fallback. The sign-in screen now distinguishes incorrect credentials from a valid login that is missing its RAFT role claim.
- **Step 7 change and reason:** Dashboard activity now includes the kept-visit rate, calculated from ScheduledFor rows with a recorded kept/not-kept status. Visits with no status are excluded so the percentage describes only recorded outcomes.

## Host it

Publish the contents of this folder on any static web host, with `index.html` as the site entry point. There is no build step. Serve it over HTTPS (or a local HTTP development server); browser module imports do not work reliably when opening `index.html` directly as a `file://` URL.

The Supabase project URL and publishable key are configured in `app.js`. The key is intended for a browser client. Supabase must already expose the `raft` schema through its Data API for these queries to work. Keep authorization in the existing database grants and row-level security policies; do not replace the publishable key with a service-role key.

## Sign-in and role access

- Sign-in calls `supabase.auth.signInWithPassword({ email, password })`.
- Supabase Auth restores its persisted session when the page reloads.
- The site reads `role` from the access-token payload and accepts `raft_admin`, `raft_scheduler`, or `raft_counselor`.
- No RAFT table is queried until a signed-in session with one of those role claims is present.
- Sign-out is available in the shared app navigation on every signed-in screen.
- All select lists name their columns explicitly. Scheduler queries omit `employee.wage`, `appointment.notes`, and `scheduledfor.assignment`; the other roles only request those columns where permitted.
- No delete operation is provided.

## Available actions

- **Admin:** manage clients, contacts, appointments, client appointment details, rooms, and employee details including wage.
- **Scheduler:** manage clients, contacts, employee scheduling details, appointments, kept status, and rooms. Employee wage, private appointment notes, and client assignment details are omitted from both queries and forms.
- **Counselor:** update appointment notes and each linked client's assignment and kept status. Other record changes are not offered.

Home shows upcoming appointments first, then the latest recorded appointments if there are no future appointments. Dashboard activity uses the latest month present in the appointment table so historical sample data remains visible.

## Multi-table saves

The provided schema has no transaction endpoint for browser clients. Creating a client saves its `person` row and then its `client` row; adding an appointment with selected clients saves the `appointment` row and then its `scheduledfor` links. If a later step is denied or fails, the page reports which earlier row was already saved so staff can follow up. No database function or schema change was added to make these operations transactional.
