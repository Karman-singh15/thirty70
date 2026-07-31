# Thirty70 — Collaborative LeetCode

Solve LeetCode problems together with friends in real-time. Create private rooms, share invite links, search problems via LeetCode's GraphQL API, and collaborate in a shared code editor.

## Features

- **Clerk authentication** — Sign up / sign in with email, Google, etc.
- **Personal rooms** — Create rooms and share invite links with friends
- **LeetCode search** — Search and load problems via LeetCode GraphQL API
- **Collaborative editor** — Monaco editor with live code sync between participants
- **Split-pane UI** — Problem description on the left, code editor on the right

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure Clerk

1. Create an app at [clerk.com](https://clerk.com)
2. Copy `.env.local.example` to `.env.local`
3. Add your Clerk keys:

```bash
cp .env.local.example .env.local
```

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Usage

1. **Sign up** on the landing page
2. **Create a room** from the dashboard
3. **Copy the invite link** and share it with friends
4. **Search for a LeetCode problem** in the room
5. **Code together** — changes sync automatically between participants

## Architecture

| Layer | Tech |
|-------|------|
| Auth | Clerk (`@clerk/nextjs`) |
| Frontend | Next.js 16 App Router, Tailwind CSS |
| Editor | Monaco Editor |
| LeetCode data | LeetCode GraphQL API (proxied via `/api/leetcode/*`) |
| Room state | In-memory store (dev/demo — swap for a DB in production) |
| Sync | Polling every 1.5s via `/api/rooms/[id]/sync` |

## Production notes

- **Room persistence**: Rooms are stored in memory and reset on server restart. For production, replace `lib/rooms.ts` with a database (Postgres, Redis, etc.).
- **Real-time sync**: Current polling works for small groups. For lower latency, consider WebSockets (PartyKit, Liveblocks, or Socket.io).
- **LeetCode premium**: Only free problems can be loaded. Premium problems are marked and disabled in search results.

## Project structure

```
app/
  page.tsx              Landing page
  dashboard/page.tsx    Room list
  room/[id]/page.tsx    Collaborative room
  join/[code]/page.tsx  Invite link handler
  sign-in/              Clerk sign in
  sign-up/              Clerk sign up
  api/
    leetcode/           LeetCode GraphQL proxy
    rooms/              Room CRUD + sync
components/             UI components
lib/
  leetcode.ts           GraphQL queries
  rooms.ts              Room store
proxy.ts                Clerk middleware (Next.js 16)
```
