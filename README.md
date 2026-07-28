# OptionQuest Marketing Website & Serverless APIs

This repository contains the source code for the OptionQuest landing page, privacy policy webpage, and backend serverless APIs supporting the mobile application's multiplayer functions.

*   **Production URL**: `https://playoptionquest.com`
*   **Hosting Platform**: **Vercel** (Connected to GitHub with automatic production deployments on commits to `main`).
*   **Database Infrastructure**: Redis (used to store unique usernames and high-score standings).

---

## 🌟 Key Features

### 1. Mobile-Responsive Landing Page (`index.html`)
*   Fully optimized layout using fluid Vanilla CSS media queries.
*   Collapses navigation links into a centered column on tablet screens ($\le$ 768px).
*   Stacks App Store & Google Play CTA buttons vertically on mobile screens ($\le$ 480px) for easier tapping.
*   Renders features in a single-column stacked grid on phone screens.

### 2. Privacy Policy Page (`privacy.html`)
*   Fully responsive document viewport with scaled mobile typography.
*   Includes detailed disclosures regarding optional in-app Firebase Analytics collection, Crashlytics, and Google AdMob.

### 3. Branding & Assets
*   **`favicon.png`**: Custom web-optimized $32 \times 32$ pixel neon cyberpunk favicon generated from the OptionQuest launcher asset. Linked in the `<head>` of all HTML documents to display in browser tabs.

### 4. Serverless API Endpoints (`/api`)
Serverless backend routines deployed on Vercel:
*   `GET /api/leaderboard`: Fetches the live Global player rankings from Redis.
*   `POST /api/submit-score`: Securely submits a player's high score. Validates the submission using their unique `deviceToken` to prevent fraud.
*   `POST /api/claim-username`: Registers unique, case-insensitive usernames mapped to a player's device token.

---

## 🛠 Deployment & Workflow

Any modifications pushed to the `main` branch of this repository are instantly processed, compiled, and deployed live to production by Vercel.
