# NativeSquare Template Monorepo

A private monorepo template used by NativeSquare to bootstrap greenfield projects.

## Tech Stack

- **Monorepo**: [Turborepo](https://turbo.build/) + [pnpm](https://pnpm.io/) workspaces
- **Web & Admin**: [Next.js 16](https://nextjs.org/) (App Router), [React 19](https://react.dev/), [Tailwind CSS v4](https://tailwindcss.com/)
- **Mobile**: [Expo](https://expo.dev/) (SDK 55), [React Native](https://reactnative.dev/), [NativeWind](https://www.nativewind.dev/)
- **Backend & Database**: [Convex](https://convex.dev/)
- **Authentication**: [Convex Auth](https://labs.convex.dev/auth)
- **Email**: [Resend](https://resend.com/) + [React Email](https://react.email/)
- **Language**: TypeScript everywhere, end-to-end type safety

## Project Structure

```text
├── apps/
│   ├── web/            # Next.js web app
│   ├── admin/          # Next.js admin panel
│   └── native/         # Expo React Native app
├── packages/
│   ├── backend/        # Convex backend (schema, functions, auth)
│   ├── shared/         # Shared constants (app name, slug, etc.)
│   └── transactional/  # React Email templates
├── scripts/            # Utility scripts (deploy preview, etc.)
├── turbo.json          # Turborepo task configuration
└── pnpm-workspace.yaml # Workspace definition
```

## Bootstrapping a New Project

### 1. Create and clone the repo

Create a new GitHub repository from this template, then clone it and navigate into it:

```sh
git clone <your-new-repo-url>
cd <your-new-repo>
```

### 2. Install dependencies

```sh
pnpm install
```

### 3. Connect the backend to Convex

```sh
cd packages/backend
npx convex dev
```

You will be prompted to create a new Convex project or link an existing one. Once connected, the Convex dev server will start and generate a `.env.local` file in `packages/backend/` containing your `CONVEX_URL`.

### 4. Set up environment variables for the apps

Create a `.env.local` file in each app directory (`apps/web`, `apps/admin`, `apps/native`) with the same Convex URL from `packages/backend/.env.local`, but prefixed for each platform:

**`apps/web/.env.local`** and **`apps/admin/.env.local`**:

```env
NEXT_PUBLIC_CONVEX_URL=<your-convex-url>
```

**`apps/native/.env.local`**:

```env
EXPO_PUBLIC_CONVEX_URL=<your-convex-url>
```

### 5. Configure authentication

Convex Auth requires a Resend API key and a JWT key pair.

#### a. Create a Resend API key

Go to the [NativeSquare Resend account](https://resend.com/api-keys) and create a new API key.

#### b. Add the Resend key to Convex

In the [Convex dashboard](https://dashboard.convex.dev), go to your **Development** deployment's environment variables and add:

```sh
AUTH_RESEND_KEY=<your-resend-api-key>
```

#### c. Generate JWT keys

```sh
cd packages/backend
node generateKeys.mjs
```

This will output two environment variables: `JWT_PRIVATE_KEY` and `JWKS`. Copy both and add them as environment variables in your Convex Development deployment.

#### d. Add the site URL

Add one more environment variable in the Convex dashboard:

```sh
SITE_URL=http://localhost:3000
```

You should now have **four** environment variables in your Convex Development deployment:

| Variable          | Source                     |
| ----------------- | -------------------------- |
| `AUTH_RESEND_KEY` | Resend dashboard           |
| `JWT_PRIVATE_KEY` | Output of generateKeys.mjs |
| `JWKS`            | Output of generateKeys.mjs |
| `SITE_URL`        | `http://localhost:3000`    |

At this point, the **web** and **admin** apps are ready to go.

### 6. Set up the native app (Expo / EAS)

#### a. Initialize EAS

```sh
cd apps/native
eas init
```

When asked if you want to create a new project, select **yes**. The CLI won't be able to automatically write to `app.config.ts`, so you'll need to manually paste the output (project ID / slug) into [apps/native/app.config.ts](apps/native/app.config.ts) yourself.

#### b. Configure EAS Update

```sh
eas update:configure
```

Again, manually paste the output into [apps/native/app.config.ts](apps/native/app.config.ts).

#### c. Create a development build

Create a development build with EAS and you're good to go:

```sh
eas build --profile development --platform <ios|android>
```

### 7. Run the apps

From the root of the monorepo:

```sh
pnpm dev
```

This starts the Convex backend, web app, admin panel, and native dev server via Turborepo. Use the arrow keys to switch between logs for each process.

## Preview Deployments

To set up preview deployments, you need a Convex preview deploy key:

1. Go to your project's settings in the [Convex dashboard](https://dashboard.convex.dev)
2. Create a **preview deploy key**
3. Create a file `packages/backend/.env.preview` and add the key:

```sh
CONVEX_DEPLOY_KEY=<your-preview-deploy-key>
```

You can then run `pnpm deploy:preview` from the root to trigger a preview deployment.

## Useful Commands

| Command              | Description                              |
| -------------------- | ---------------------------------------- |
| `pnpm dev`           | Start all apps and backend in dev mode   |
| `pnpm build`         | Build all apps                           |
| `pnpm lint`          | Lint all packages                        |
| `pnpm typecheck`     | Type-check all packages                  |
| `pnpm clean`         | Clean build artifacts and `node_modules` |
| `pnpm format`        | Format code with Prettier                |
| `pnpm deploy:preview`| Deploy a preview build                   |
