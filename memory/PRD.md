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

## Backlog
- P1: Audit referral and daily bonus rules (both referee and referrer get the bonus; daily ₹10 via a Claim button every 24h, 3× wagering)
- P1: Styled modals instead of window.prompt/confirm in the verifier portal
- P1: Proper date picker in reports
- P2: WebSocket push instead of 1s polling
- P2: Height-adaptive layout for phones shorter than 740px
- P2: Push/SMS notifications
- P2: Legal/compliance review before real money goes live
