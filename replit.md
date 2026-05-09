# UMKM Digital

An Indonesian e-commerce marketplace platform for local SMBs (Usaha Mikro Kecil Menengah) — buyers can browse and purchase products, sellers manage their stores, and admins oversee the whole platform.

## Run & Operate

- Frontend: `pnpm --filter @workspace/umkm-digital run dev` (served at `/`)
- API server: `pnpm --filter @workspace/api-server run dev`
- Required secrets: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_CLOUDINARY_CLOUD_NAME`, `VITE_CLOUDINARY_UPLOAD_PRESET`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite (artifact: `artifacts/umkm-digital/`)
- Backend: Supabase (auth + realtime database via Supabase JS client)
- Image uploads: Cloudinary
- CSS: Custom CSS variables (no Tailwind in the main app)

## Where things live

- `artifacts/umkm-digital/src/App.jsx` — entire frontend app (single large file, ~6400 lines)
- `artifacts/umkm-digital/src/services/supabaseData.js` — Supabase client + Firestore-compatible API shim
- `artifacts/umkm-digital/src/services/cloudinary.js` — image upload helper
- `artifacts/umkm-digital/src/app.css` — all custom CSS styles
- `artifacts/umkm-digital/public/service-worker.js` — PWA service worker

## Architecture decisions

- App.jsx is a monolithic single-file React component (~6400 lines) — this was how it was built originally; all UI, state, and business logic lives here.
- Supabase is used for auth, database, and realtime — the `supabaseData.js` shim provides a Firestore-compatible API surface so legacy Firebase-style calls work against Supabase tables.
- No Replit PostgreSQL — the app uses Supabase as its database; the shared `lib/db` package is unused by this app.
- CSS is plain custom properties (no Tailwind) — the app has its own design system with `--orange`, `--bg`, etc.

## Product

Three user roles:
- **Buyer**: Browse products by category/location, add to cart, checkout, track orders, chat with sellers
- **Seller**: Manage product listings, process orders, view wallet/earnings, withdraw funds
- **Admin**: Oversee all users/orders, manage commission settings, approve seller withdrawals, view analytics

## Gotchas

- `VITE_*` env vars must be set as Replit Secrets (not `.env` file) to be picked up by Vite
- The Supabase shim in `supabaseData.js` polyfills Firestore-style calls (`collection`, `doc`, `onSnapshot`, etc.) on top of Supabase — don't replace with direct Supabase calls without updating all call sites in App.jsx
- `App.jsx` uses `.jsx` extension, not `.tsx` — TypeScript checking is skipped for it intentionally
