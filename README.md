# BuildFin — Building Finance Manager

Next.js app deployed on Vercel, with data stored in MongoDB Atlas.

## Setup

1. Create a free MongoDB Atlas cluster (M0) and a database user.
2. In Atlas → Network Access, allow `0.0.0.0/0` (Vercel has no fixed IPs).
3. Copy the `mongodb+srv://…` connection string (Connect → Drivers).
4. In Vercel → Project → Settings → Environment Variables, add
   `MONGODB_URI` with that string (optionally `MONGODB_DB`, default `buildfin`),
   then redeploy.

For local development copy `env.local.example` to `.env.local` and run `npm run dev`.

Anyone can create an account; each account sees only its own data.
Building Setup → Backup & Restore downloads or restores a JSON copy of an account's data.
