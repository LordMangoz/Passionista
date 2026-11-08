# Passionista — Project Summary

## What it is

Passionista is a fashion and wardrobe web app. Its current experience combines a personal wardrobe view with a separate stylist studio for asking questions about clothing photos.

## Technology

- **Frontend:** React 19, TypeScript, and Vite, in `client/`
- **Authentication:** Auth0 React SDK; configuration is read from `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, and optionally `VITE_AUTH0_AUDIENCE`
- **Backend:** Express with TypeScript, in `server/`
- **Development API routing:** Vite proxies `/api` requests to `http://localhost:3000`

## Current features

- The home page presents the Passionista landing experience and sign-in/sign-up controls.
- When Auth0 is configured, authenticated users are shown the wardrobe page; otherwise, the app displays a setup-oriented landing page.
- The wardrobe page authenticates API requests with an Auth0 access token and displays tagged clothing items from `workspace.image_project.clothing_items`, including their source images.
- Wardrobe uploads go to Databricks through the Express image route. Gemini tagging runs in the background; the page waits for tagging before refreshing the garment list.
- Account data is scoped to the verified Auth0 `sub`. Different Auth0 connections have separate `sub` values and therefore separate wardrobes.
- Photos previously saved in this browser remain in local storage but are no longer displayed in the wardrobe.
- The `/stylist` page provides photo upload and drag-and-drop, four selectable styling questions, and a response panel.
- Stylist uploads accept JPEG, PNG, and WebP files up to 10 MB. The Express API stores images in Databricks and sends stylist questions to Gemini.

## API and implementation status

- `GET /api/wardrobe` returns the signed-in user's tagged garment rows and is protected by Auth0 JWT validation.
- `POST /api/images` uploads a photo, stores its metadata, and starts background Gemini tagging. `GET /api/images/:id/file` serves an image only to its owner.
- The Databricks tables are `workspace.image_project.images` and `workspace.image_project.clothing_items`; image bytes are stored in the `image_files` volume.
- The server requires Databricks credentials, `GEMINI_API_KEY`, and Auth0 domain and API audience environment variables.
- The repository root has a brief README; the client README is still largely the Vite starter template.

## Running locally

Install dependencies in both `client/` and `server/`, then run each development server in a separate terminal:

1. In `server/`, run `npm run dev` (Express listens on port 3000).
2. In `client/`, run `npm run dev` (Vite serves the frontend and proxies `/api` to the Express server).
3. Configure Auth0, Databricks, and Gemini values in the root environment file.

The client also provides `npm run build` and `npm run lint`. The server package currently provides a development script only.

## Main source locations

- `client/src/App.tsx` — home, authentication-aware page selection, and landing page
- `client/src/StylistPage.tsx` — stylist studio interactions and API request
- `client/src/WardrobePage/Wardrobe/Wardrobe.tsx` — wardrobe data fetching and card rendering
- `client/src/WardrobePage/ClothingCard/ClothingCard.tsx` — individual clothing card
- `server/server.ts` — Express app and API route registration
- `server/routes/imageRouter.ts` — authenticated image, wardrobe, and stylist API routes
- `server/databricks.ts` — Databricks SQL and volume-file client
