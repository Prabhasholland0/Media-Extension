# MediaHub

MediaHub now comes in two parts:

- **`platform/`: the new multi-organization app** (Planning Center style). Anyone can create an account, start or join an organization, and plan events.
- **`dist/`: the original single-team NLAG Service Team app**, unchanged and still working on the same Supabase project.

## MediaHub platform (`platform/`)

### What it does

- **Accounts:** sign up with name, email and password (12+ characters), sign in, reset a forgotten password.
- **Organizations:** any signed-in person can create one and becomes its **owner**. It starts with a preset (Media team, Church services, or empty). People join with an 8-character **invite code or link** (`?join=CODE`). One account can belong to many organizations and switch between them.
- **Roles:** owner, admin, member. Admins plan and schedule; members see published events, their own schedule, and the team list (names only; contact details are admin-only).
- **Church profile & campuses:** name, time zone, contact details and one or more campuses; events can belong to a campus.
- **Roles & permissions:** Owner, Church admin, Scheduler and Member are built in; admins can add custom roles from nine named permissions. Nobody can grant a permission they do not hold.
- **Invitations:** invite by email with a role (the person accepts after signing in with that confirmed email; no email is sent yet), or share an invite code.
- **Departments & positions:** e.g. Media → Producer, CCU, Camera. Each department has leaders, coordinators and members; leaders schedule only their own department. Departments can be archived instead of deleted.
- **Setup wizard:** seven steps for a new organization (details, campuses, departments, first event, leaders, volunteers, publish).
- **Activity log:** changes to people, roles, departments, events and schedules are recorded and visible to roles with "View the activity log".
- **Platform admin:** MediaHub operators can list organizations (counts only) and suspend or reactivate them; they cannot read church records.
- **Events:** pick a date, **how many services** (1–6, each with a name and start time), and **how many people each position needs** per service.
- **Scheduling:** fill each service seat from people trained for it. **Auto-fill** keeps your choices, skips blocked-out people, fills scarce positions first and favours people with fewer upcoming assignments. Warnings show declines, blockouts and untrained picks.
- **Responses:** scheduled people see the request on their Home page and **accept or decline**. Re-saving a roster keeps existing answers.
- **Service plan:** ordered run sheet (sections, items, songs, media, message) with minutes and live clock times per service.
- **Blockout dates:** members mark days they cannot serve.
- **Publish / duplicate:** drafts are admin-only until published. Duplicate copies services, needs and plan to a new date.
- **Cancel / complete:** cancelling tells everyone scheduled and keeps the event so it can be reopened.
- **Service types:** save an event's services and people needed as a type (e.g. Sunday Gathering every Sunday), then create draft events for up to 26 weeks in one step, or start a new event from a type.
- **Replacements:** a confirmed person can ask for cover; everyone trained and free that day, plus the schedulers, is told, and the first to tap "Take this spot" gets it.
- **Availability:** schedulers tap "Ask for availability" (or a service type does it for every new event); members answer Available or Not available per service on Home, like the NLAG app. Auto-fill puts people who said available first and never picks people who said not available.
- **Swipe between services:** on a phone, swipe left or right on the People or Plan tab to move between services (the NLAG gesture, ported from `dist/service-transitions.js`).
- **Calendar & My schedule:** a month calendar of every event you can see (a list on phones), and one page for your own serving: availability answers, your spots with accept, decline or find cover, and spots you can take.
- **Look and feel:** grouped menu (You, Plan, People, Admin), a bottom bar on phones, light and dark themes (follows the device, or pick one on your profile; saved on that device), and loading placeholders instead of a blank screen.
- **Notifications:** in-app only (scheduled, declined, needs cover, covered, cancelled). Email and push are not set up yet.

### Turn it on

1. Back up the database, then in the Supabase SQL editor run `supabase/004_platform.sql` followed by `supabase/005_phase1_stabilize.sql` `supabase/006_tenant_core.sql` `supabase/007_scheduling.sql`, `supabase/008_availability.sql` and `supabase/009_nlag_import.sql`. They add tables and functions, reuse `profiles`, and keep platform accounts out of the NLAG team app. Full order for a new project:
   `001_schema → 002_storage → camera-count → 003_harden_performance → camera-not-needed → campuses → permanent-delete → phone-signin → 004_platform → 005_phase1_stabilize → 006_tenant_core → 007_scheduling → 008_availability → 009_nlag_import` (checked by `tests/phase1.test.mjs`, order in `tests/migrations.mjs`).
2. In Supabase Auth, set the Site URL / redirect URLs to where `platform/` is hosted and keep email confirmation on.
3. `platform/config.js` holds the public URL and publishable key (already filled in for the current project). Never put a secret or service-role key there.
4. Deploy the `platform/` folder as a static site (it has its own `_headers`). Open it, create an account, then create your organization.

Add `?demo` to the URL to open a **sample workspace** that never touches the database; it has a "View as" switch to see the member experience.

### Moving the NLAG team into the platform

`009_nlag_import.sql` only creates `platform_private.import_nlag(owner, name)`. After a backup, run in the SQL editor:

```sql
select * from platform_private.import_nlag('<NLAG admin profile id>', 'New Life Assembly of God');
```

It reads the NLAG tables without changing them and creates one organization with Kompally and Eden Square campuses, a Video department (Producer, CCU, Camera), every active member with their skills, one event per NLAG service and date (exact camera count, "Not needed" cameras left out), published rosters as confirmed, and availability answers. It sends no notifications. Running it again adds only what is new, and it returns a table comparing NLAG and platform counts. The NLAG app keeps working throughout.

The audit, architecture, security review and phased roadmap are in [docs/PLATFORM-AUDIT-AND-PLAN.md](docs/PLATFORM-AUDIT-AND-PLAN.md).

### Security model

All tables use row-level security. Each organization's rows carry `org_id` with composite foreign keys, so an event, position, member or assignment can never point into another organization. Membership, roles, invites, roster saves and responses go through checked database functions, and access is checked by named permission (`has_permission`). `tests/platform.test.mjs` exercises isolation, roles, invites, rosters, responses, blockouts, duplication and deletion against PostgreSQL (PGlite); `tests/scheduling.test.mjs` covers atomic event creation, service types, notifications and replacements; `tests/tenant.test.mjs` covers role escalation, cross-organization isolation, department-leader scoping, email invitations, the activity log, suspension and the platform admin view.

To make someone a platform operator, run in the SQL editor: `insert into platform_admins(user_id) values ('<their auth user id>');`

---

# Original Service Team app (`dist/`)

A responsive web application for desktop and mobile browsers. Members choose services; admins assign Producer, CCU, and a configurable number of cameras (0–16, default 8).

## Current delivery

The public Supabase project URL and publishable key are configured for project `bwsdlzeqwjozxlkpkdhy`. The connection was verified; application tables still need to be created. Until then the website shows a setup-pending message. No secret key is included. If the public configuration is cleared, the website opens in a clearly labeled **sample workspace**. Sample edits last for the current visit and are never presented as database saves. No real users or contact information are seeded. This is a mobile-friendly website, not an App Store or Play Store native package.

## Activate the real application

1. Create or select a Supabase project. Run `supabase/001_schema.sql`, `supabase/002_storage.sql`, and `supabase/camera-count.sql` in its SQL editor. These migrations target a new project; do not apply blindly over an existing schema.
2. Put the project URL and **public publishable/anon key** in `dist/config.js`. Never use a service-role or secret key in browser code. Redeploy the static `dist/` folder.
3. In Supabase Auth, enable email/password authentication, set the Site URL to the deployed app origin, and allow that origin as an email-confirmation redirect URL.
4. Register your own account and confirm its email. Profiles are created automatically for every registered account.
5. In the trusted Supabase SQL editor, promote the first administrator using that account's actual UUID:

   ```sql
   update public.profiles
   set is_admin = true
   where id = 'REPLACE-WITH-YOUR-ACCOUNT-UUID';
   ```

6. Sign in again. In Team members, assign each member's Camera, Producer, and/or CCU capabilities. Users cannot grant themselves skills or admin access. Members complete their name, phone and optional profile photo, then submit availability.
7. Confirm access with one admin and one member account before inviting the whole team. Supabase login and database authorization remain required independently of the hosting audience.

## Workflow and rules

- A date identifies the service day, with the next Sunday selected initially. Any date can be selected; availability is not a recurring weekly template.
- Submission atomically writes all four service responses in Supabase. Unchecked services become Not Available. A missing row means Not Submitted.
- Admins see the registered team automatically, filter by role, service and status, and receive refreshed data every 15 seconds while the availability or schedule view is open and no unsaved edits are present.
- Profiles include the actual Supabase user UUID, name, email, phone, private photo path, skills, active flag and admin flag.
- Admins can assign only active members with both availability and the required capability. A member holds at most one duty per service, including Producer and CCU. The same person can serve in different services.
- Auto Assign preserves existing manual choices and uses maximum matching to fill remaining positions. It proposes a draft; it does not publish automatically or guarantee rotation/fairness.
- Drafts may be incomplete. Publishing requires Producer, CCU, and every selected camera position. Admins choose the camera count per service from 0 through 16; reducing it prompts before clearing removed camera assignments. Assignments reference UUIDs, never only names. Database constraints prevent duplicate positions and duplicate people within a service.
- Authorized RPCs validate all writes inside transactions. A transaction lock serializes schedule/availability/eligibility mutations to prevent races; revision checks reject stale admin saves.
- Database indexes cover assignment, service and audit lookups, while RLS authentication values are initialized once per query for predictable performance as the team grows.
- Withdrawing availability, removing a required skill or deactivating an assigned member removes affected duties and returns the schedule to draft. The admin must review and republish. Previously copied WhatsApp text cannot be recalled.
- Members can read their own profile and availability and the published roster. Admins can read team contact details and drafts. Anonymous callers cannot read team data. Users cannot directly mutate tables.
- Profile photos use a private Supabase Storage bucket with owner/admin access and signed URLs; maximum 2 MB, JPEG/PNG/WebP.
- The browser uses a restrictive Content Security Policy, anti-framing and MIME-sniffing headers, limited browser permissions, explicit database column selection, and a 12-character minimum for new account passwords. Supabase secret/service-role keys are never shipped to the browser.
- WhatsApp generation prepares copyable text only. No message is sent automatically.

## Run and test

Serve `dist/` with any static HTTP server. No build is needed for the checked-in browser assets. To reproduce the vendored Supabase SDK after installing pinned dependencies:

```text
npm ci
node build-vendor.mjs
npm test
node check.mjs
```

Tests cover eligibility, scarce-role matching, preserved manual choices, duplicate duties, missing availability, partial drafts, and a PostgreSQL-compatible PGlite integration test for the database migration, row-level security, admin authorization, persisted schedules, stale revisions, withdrawal and skill-change invalidation.

Database tests use local mock Supabase authentication tables/functions. Real Supabase email delivery, deployed Auth, storage upload policies and multi-device operation still require a configured project for end-to-end verification. PGlite tests do not simulate concurrent database sessions.

Source reference: [Supabase JavaScript initialization](https://supabase.com/docs/reference/javascript/initializing), [email sign-up](https://supabase.com/docs/reference/javascript/auth-signup), and [user profiles](https://supabase.com/docs/guides/auth/managing-user-data).
