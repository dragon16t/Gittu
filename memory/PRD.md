# BLACKBA — ODD/EVEN Game Platform PRD

## Original problem statement
Complete ODD/EVEN real-money game platform (mobile-first PWA, premium black & silver per the attached design). It covers user app, admin panel, payment verifiers and an automated financial system: 30s server rounds, 2–3s reveal, 1.95× total return, UPI QR deposits routed to online verifiers, withdrawals, 10% verifier commission, practice mode with 10 results, admin TOTP MFA + backup codes, reports and audit. Background music on the game screen only (user-uploaded MP3).
Later additions:
- Referral ₹300 (5× wagering) when a referee makes a deposit of ₹500 or more
- Deposit wagering of 1×
- ₹10 daily coupon (3× wagering) with a Claim button, auto-credited if not claimed
- Minimum withdrawal ₹300, paid to a UPI ID
- Brand name BLACKBA
- T&C tick box on sign-up and login
- Customer support tickets (user → admin → share with agent → agent approves deposit / processes withdrawal with proof upload → admin resolves, with full tracking)
- Single-screen mobile game layout with fixed header and fixed bet bar

## Architecture
- FastAPI (`/app/backend`): core.py (db, sessions, ledger, storage), game.py (engine loop), payments.py, promotions.py (referral/daily/wagering loop), tickets.py, routes_auth/user/verifier/admin.py
- MongoDB with unique indexes for idempotency (ledger.key, bets client_key, deposits.utr, coupons.key, commission key)
- React (`/app/frontend/src`) with three portals: `/` (user), `/admin`, `/verifier`. Each portal has its own httpOnly cookie.
- Emergent object storage for QR images and payment proofs. Music is served from `/public/game-music.mp3`.

## Implemented (2026-06)
- Auth: register with recovery code, login, forgot password (recovery code + bank last4), change password, rate limits, per-portal sessions, Origin check
- Game engine: CSPRNG, result hash recorded before reveal, atomic settlement, recovery after restart. Modes: random / risk (exposure limits, pause, promo disable)
- Practice mode with admin log
- Wallet ledger, reconciliation, CSV reports
- Deposits: random online verifier assignment, UTR submission, verification, cancel
- Withdrawals: UPI only, reserve, routing by account funds, reassign, refund
- Verifier portal: temp creds, forced password change, online/offline toggle, commission ledger
- Admin: dashboard, game config + history, users + manual adjustments (password + TOTP), verifiers, accounts, payments, tickets, practice, reports, audit, security
- Referral, daily coupons, wagering enforcement
- T&C on sign-up (enforced by backend) and login (enforced in the UI)
- Support tickets with timeline and proofs

- Iteration 3–4:
  - Wagering progress bar (Wallet and Withdraw pages)
  - Agent Workload live admin tab
  - Live win feed ticker on the game screen
  - Ticket chat alerts (toast polling for users and verifiers)
  - Compact single-screen game layout with the result shown as a closed capsule
  - Smaller fonts (15px base) and a clean BLACKBA-only login page

- Iteration 5:
  - Removed the Minority Wins warning banner from the whole platform (Mode 2 logic is unchanged)
  - Mode 3, Fair Proof (admin mode "fair"): results for the next 10 rounds are pre-generated in `fair_seeds` and published as SHA256(number:dice:salt). Used/void seeds are revealed after the round. The /fair page checks each hash in the browser, and a shield icon appears in the game header only while this mode is active. Endpoint: GET /api/game/fair

- Iteration 6:
  - Admin Game tab: "Mode 3 · Next 10 results (admin only)" table (round, result, dice, hash) shown while mode = fair, via the fair_upcoming field of GET /api/admin/game
  - Shield / Fair Proof icon removed from the user app (the /fair page still exists but is not linked)
  - Sound fixed: audio now unlocks on click/touchend/keydown (pointerdown doesn't count on mobile), and the AudioContext is unlocked during the user tap, so music, bet and win sounds work
  - Read-only integrity audit: 0 wrong settlements, every stake and win has a ledger entry, and every wallet balance matches its ledger. No financial data is ever deleted (only sessions, rate limits and 2FA codes expire)

- Iteration 7:
  - Referral: only the friend's very first verified deposit counts (₹500 or more). Referrer coupon (default ₹300) plus friend "Welcome bonus" coupon (default ₹150), both 5× wagering, claim or auto-credit after 72h. Admin sets the amounts (config referral_bonus/friend_bonus). GET /api/promo/rules
  - Gold Refer & Earn page (split bonus cards, steps, a richer wagering table) and richer coupon cards in Messages
  - Live visitors: POST /api/presence/ping every 20s (max 5 visitor IDs per IP). GET /api/admin/live, plus a 5-minute snapshot history kept for 2 days (GET /api/admin/visitors/history) with a recharts graph on the dashboard
  - Admin frontend moved to /keepalittle and /keepalittle/login (/admin redirects to /)
  - Ticker 2× faster, BLACKBA favicon and PWA icons, manifest, sw.js, Add to Home Screen banner (Android install prompt, iOS instructions)
  - Safe-area headers, tighter side circles on screens shorter than 680px, timer clock offset adjusted for network delay, refetch when the tab becomes visible
  - Login no longer needs the T&C tick (sign-up still requires it)

- Iteration 8:
  - Add to Home Screen banner removed completely
  - The whole document scrolls (html/body no longer overflow-hidden). Header and bet bar are sticky, overflow-x: clip
  - Timer: freezes at 00:00 ("Closed", then "Result") until the reveal animation ends. The server holds the result 2s (RESULT_HOLD_SECONDS) before the next round. A missed reveal (tab hidden) still shows the correct last result
  - Bet bar has a fixed-height hint/bets line, so it no longer jumps when a bet is placed. The input is blurred after a bet so the keyboard closes
  - Countdown tick: soft 1046Hz tick at 5-4-3-2s and a brighter 1568Hz tick at 1s. Respects the music mute (sfx.playTickSound)
- Iteration 9 (deposit speed):
  - eligible_deposit_account: 3 queries in total (verifiers, aggregated loads, accounts) instead of 2 per verifier. Picks the online verifier with the LEAST open deposits; random (SystemRandom) among ties; at-capacity verifiers skipped; then a random account of that verifier
  - In-memory file cache (300 entries) in core.get_file/put_file, QR cache warmed at startup (server.warm_qr_cache). The deposit QR response has Cache-Control 24h
  - Deposit page shows UPI details immediately while the QR loads in the background (pulse placeholder)
- Iteration 10 (safe file storage):
  - Cloudinary (cloud dcvuqcqjn, keys in backend/.env) is the backup copy of EVERY upload (QR codes, ticket proofs). type=authenticated (private, signed-URL read). put_file writes to both stores and succeeds if either works. get_file order: memory cache, then primary storage, then Cloudinary fallback
  - Startup backfill (core.backup_files_to_cloudinary) copies any file not yet backed up. Nothing is ever deleted
  - GET /api/deposits/active restores the open (initiated, under 30 min) deposit plus its QR after a page refresh
- Iteration 11 (fast withdrawal routing):
  - assign_withdrawal: only ONLINE verifiers whose account has free funds (available_funds - committed >= amount, filtered in Mongo), least open withdrawals first, random ties. Offline verifiers are used only after the request has waited 10 min (OFFLINE_FALLBACK_MIN)
  - payments.withdrawal_dispatcher runs every 5s: releases untouched "pending" requests held by offline verifiers and reassigns all unassigned ones. It also runs instantly when a verifier switches online. Removed the per-round retry from game.py
  - Verifier dashboard refreshes every 4s (was 8s)
- Iteration 12 (speed + fixes):
  - Config cached 2s in memory (invalidate_config() on every write). /game/state shared part cached 0.5s behind a lock, per-user part = 1 bets query + 1 wallet query. User auth cache 3s per session (admin/verifier are never cached). 15 new indexes. Game polling is adaptive (2s mid-round, 0.9s in the last 6s)
  - Referral/welcome bonuses auto-credited on the friend's first qualifying deposit (issue_coupon auto=True). Leftover "available" referral/welcome coupons credited at startup. rewards_earned counts all referral coupons. Optimistic claim in Messages
  - Bet % buttons 100/75/50/25 under the stake presets (floor to ₹, capped at max stake)
  - Deposit page always opens on the amount screen. An unfinished deposit shows a "Continue" card. A new deposit cancels the old one. "Change amount / Cancel" on the QR screen
  - Deposits go ONLY to an online verifier's account whose QR file exists. Admin Accounts tab shows "Missing · re-upload" for broken QRs
  - "Pay with UPI app" on the deposit QR screen: upi://pay deep link (pa, pn, am, cu=INR, tn="Deposit <id8>") plus direct GPay (tez://upi/pay), PhonePe (phonepe://pay) and Paytm (paytmmp://pay) buttons
- Iteration 13 (strict timer):
  - ROOT CAUSE of timer resets / instant results: every backend instance ran its own engine, and recover() force-closed the live round. Fix: a Mongo lease lock (db.locks id=engine, 15s lease, renewed every 4s, game.INSTANCE) so only ONE engine runs. recover() now waits for an open round's closes_at instead of closing it early. Verified: a second engine never led, and rounds close at exactly 30.0s
  - OutcomeCard overlay (gold WIN card with +amount and stake / muted LOSS card with −stake) replaces the result toasts. Auto-closes after 3.6s/2.8s, tap to close
  - Deposit presets 100/300/400/500/1000/2000/5000 (minimum ₹100 already enforced by the server)
- Iteration 14 (deposit timer):
  - Deposits get expires_at = created + 10 min (DEPOSIT_WINDOW_MIN). The dispatcher loop (every 5s) marks stale "initiated" deposits as "expired". Verifier load, /deposits/active and resume all use the 10-min window
  - UTR can still be submitted on an initiated/expired deposit up to 30 min after creation (UTR_GRACE_MIN), so players who paid late don't lose money
  - Deposit QR screen: "Pay within MM:SS" countdown with a progress bar (turns red in the last 60s), and a "Payment window closed" note when it reaches zero
- Iteration 18: The timer ring turns GREEN with a glow once the player has a bet in the round (label "BET PLACED", side text "Bet placed"). After close it reads "BET LOCKED" with a lock icon. Last 5s = "LAST CALL" with a red/gold ring glow and a heartbeat on the countdown (plus the existing ticks). Max stake ₹50,000 (default 5000000 paise, one-time config migration flag max_stake_v2). Win amount on the OutcomeCard is 34px font-black (was 44px)
- Iteration 19 (login, guest mode, bonus, franchisee):
  - New Login screen like the reference (brand name from admin, AI dice image, feature row, Login/Sign Up tabs, mobile/username + password with eye toggle, Remember me = remembers the username, Forgot Password, stats row 1.95x / 100% / 24/7, footer). Fake "2M+ players" left out on purpose
  - Guest mode: "/" is public. Guests poll GET /api/game/public-state, and any tap on a button/link/input redirects to /login. Bet button reads "LOGIN TO PLAY"
  - Bonus Management tab: daily bonus (config daily_bonus, used by daily_for), referrer/referee bonus, send a bonus to one username or N random active users (credit now or claimable coupon, kind admin_bonus). GET/PUT /api/admin/bonus, POST /api/admin/bonus/send
  - Franchisee module (backend/partners.py, frontend pages/partner/Partner.jsx + admin/FranchiseeTab.jsx): partners are users with role=partner plus a partners profile. Admin creates a partner → one-time 72h setup link (hashed token, no plaintext password). Partner link /register?p=CODE (first-touch localStorage, validated and stored on the server as users.partner_id at registration, cannot be changed later). Dashboard stats come from the DB. Append-only partner_ledger (unique key) plus partner_wallets with conditional $inc (no negatives / duplicates). Withdrawal flow: requested → under_review → approved → processing → completed (needs a txn ref of 8-30 alphanumeric chars, unique, plus a "payment verified" confirmation) / rejected / failed / cancelled (reserved funds released). Compensation plans are versioned and can be activated only after a compliance approval ref is recorded; the commission engine is OFF. Partner settings: password change, sessions/login history, log out other sessions
  - NOT built yet: partner MFA, separate finance/support/auditor admin roles, payout-provider reconciliation API, automated test suite / docs
- Iteration 15: Player login lasts 30 days (core.USER_SESSION_HOURS = 720; cookie Max-Age 2592000, server session still revocable). Admin and verifier sessions stay at 12h
- Iteration 16 (payout safety): game.PAYOUT_BPS = 195 is hard-coded. payout_for() ignores the DB/config value, so a win is ALWAYS stake × 1.95. New rounds store 195, and /game/state reports 195. game.audit_loop (every 10 min, leader only) raises admin alerts payout_mismatch / double_win_credit. Preview audit: 47 wins, 0 wrong, 0 double credits, 0 wallet/ledger mismatches. A production read-only check was queued with the deployer (user reported ₹500 bet → ₹1950)
- Iteration 17 (wallet tamper-proofing): the balance changes ONLY through the core ledger functions (unique key per entry). The 10 callers are bet_stake, bet_win, promotion (coupon), manual_credit/debit (admin), deposit (verifier verify), withdraw_reserve/refund/complete. Every amount is validated on the server (stake min/max, deposit ₹100–₹1L, withdrawal min, admin > 0). audit_payouts also checks every wallet balance equals the sum of its ledger and raises a "wallet_mismatch" admin alert (de-duplicated). Preview: 44 wallets, 0 mismatches

## Backlog
- P1: Audit referral and daily bonus rules (both referee and referrer get the bonus; daily ₹10 via a Claim button every 24h, 3× wagering)
- P1: Styled modals instead of window.prompt/confirm in the verifier portal
- P1: Proper date picker in reports
- P2: WebSocket push instead of 1s polling
- P2: Height-adaptive layout for phones shorter than 740px
- P2: Push/SMS notifications
- P2: Legal/compliance review before real money goes live
