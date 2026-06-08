This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Environment variables

The PWA Client (`apps/web`) reads the following PUBLIC environment variables at runtime. All of them are exposed to the browser bundle (`NEXT_PUBLIC_*` prefix), so any secret-holding variable lives in `packages/backend` or a Vercel-only env (NOT here).

| Variable                            | Used by                                    | Set in                                                      |
| ----------------------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| `NEXT_PUBLIC_CONVEX_URL`            | Convex React client (every page)           | `.env.local` (dev) + Vercel project env (prod)              |
| `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` | `<AddressFirstForm>` / `app/page.tsx` (S3) | `.env.local` (dev) + Vercel project env (prod, HITL-2 #447) |

### `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` (PWA-S3 #451)

The address-first form mounts a Google Places Autocomplete widget restricted to French addresses (`componentRestrictions: { country: "fr" }`, `types: ["address"]` — decisions-log Q7). The key MUST be HTTP-referrer-restricted in the Google Cloud Console to `*.kitchen-boost.com/*` + every custom resto domain (the key is exposed to the browser, the restriction is the security control).

For local development, create `apps/web/.env.local` with:

```
NEXT_PUBLIC_GOOGLE_PLACES_API_KEY=AIza…
```

Without this var the form renders an explicit error message (« Configuration manquante (NEXT_PUBLIC_GOOGLE_PLACES_API_KEY). Contacte le support. ») rather than silently failing on type. Production configuration on Vercel is handled by HITL-2 (issue #447) — independent of any code change in this repo.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
