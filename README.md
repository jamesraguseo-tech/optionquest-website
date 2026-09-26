# OptionQuest Marketing Website & Hardened Serverless Architecture

This repository contains the source code for the OptionQuest marketing website, privacy policy, and hardened serverless backend supporting the mobile application's multiplayer functions and administrative RBAC.

*   **Production URL**: `https://playoptionquest.com` (canonical: `https://www.playoptionquest.com`)
*   **Hosting Platform**: **Vercel** (Connected to GitHub with automatic production deployments on commits to `main`).
*   **Database Infrastructure**: Upstash Redis (leaderboard sorted sets and device indices) & Supabase PostgreSQL (operator RBAC with fail-closed RLS).

---

## 🌟 Architecture & Key Features

### 1. Mobile-Responsive Landing Page & Privacy Policy
*   **`index.html`**: Fluid Vanilla CSS media queries with cyberpunk aesthetic. Collapses navigation into centered columns on mobile ($\le$ 768px) and stacks store CTA buttons.
*   **`privacy.html`**: Responsive legal disclosures for Firebase Analytics, Crashlytics, and Google AdMob.
*   **`favicon.png`**: Web-optimized $32 \times 32$ pixel launcher icon linked across all HTML heads.

---

### 2. Hardened Serverless API Endpoints (`/api`)

#### Public Endpoints (Dual-Key Rate Limited)
*   **`GET /api/leaderboard`**:
    *   Strictly read-only query fetching the top 100 players from Redis sorted set `leaderboard`.
    *   Sub-100ms response time with in-memory test account filtering.
    *   Protected by dual-key sliding-window rate limiter (60 req/min).
*   **`POST /api/claim-username`**:
    *   Registers unique, case-insensitive usernames mapped to a player's `deviceToken`.
    *   **Atomic TOCTOU Defense**: Uses Redis `HSETNX` to guarantee single-winner atomic username claims.
    *   **$O(1)$ Device Index**: Stores previous claims under `device_usernames:<cleanToken>` to eliminate $O(N)$ `hgetall` memory exhaustion attacks.
    *   Rate limited to 10 claims per 5 minutes per IP/deviceToken.
*   **`POST /api/submit-score`**:
    *   Validates device ownership before updating player score in sorted set.
    *   Enforces integer bounds validation (0 to 50,000,000).
    *   Rate limited to 30 submissions per minute.

#### Scheduled Cron Route
*   **`POST /api/cron/cleanup`**:
    *   Automated background maintenance scheduled via `vercel.json` (`0 4 * * *`, daily at 04:00 UTC).
    *   Secured via portable bitwise constant-time token comparison (`constantTimeCompare`) against `Authorization: Bearer <CRON_SECRET>`, preventing side-channel byte timing attacks across Node.js Serverless and Vercel Edge Runtime.
    *   Safely purges test accounts and legacy data without user request latency.

#### Administrative Route (Supabase Fail-Closed RBAC)
*   **`POST /api/admin/revoke-operator`**:
    *   Protected by server-side `requireOperatorAuth` edge guard querying authoritative `public.operators` database table with zero client-metadata trust (CWE-285).
    *   Enforces **Two-Layer Session Revocation**: Layer 1 application deactivation (`is_active = false`) + Layer 2 GoTrue Auth Gateway 100-year ban (`ban_duration: '876000h'`) invalidating all future token refresh attempts.
    *   Includes verified `ROOT_ADMIN_EMAIL` break-glass fallback.

---

## 🛡️ Production Security & Vercel Edge Hardening

Configured in [`vercel.json`](./vercel.json) and repository settings:
*   **Content-Security-Policy (CSP)**: `default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://www.playoptionquest.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self';`
*   **Strict-Transport-Security (HSTS)**: `max-age=86400; includeSubDomains` (conservative 1-day initial staging preventing premature preload risks).
*   **Clickjacking & MIME Protection**: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`.
*   **Referrer & Privacy**: `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()`.
*   **Deterministic Dependency Pinning**: Pinned exact dependency versions in `package.json`, `.npmrc` (`save-exact=true`), and `.github/dependabot.yml` for automated security updates.
*   **Sensitive Environment Variables**: Database secrets, `CRON_SECRET`, and Supabase keys designated as Sensitive in Vercel to restrict build-log exposure.

---

## 🗄️ Supabase Migrations (October 30 Compliance)

*   [`supabase/migrations/20260925000000_create_operators_table.sql`](./supabase/migrations/20260925000000_create_operators_table.sql):
    *   Creates `public.operators` with strict Row-Level Security (RLS) enabled and deny-all default public policy.
    *   **October 30 Breaking Change Compliant (Issue #38)**: Bundles explicit `GRANT SELECT, INSERT, UPDATE, DELETE` to `anon`, `authenticated`, and `service_role` directly into the migration.

---

## 🧪 Verification & Testing Suite

Run the automated defensive security test suite:
```bash
npm test
```
Validates 12 assertions across constant-time auth comparisons, NIST SP 800-63B password entropy, security headers in `vercel.json`, Supabase migration grants, and exact dependency pinning.
