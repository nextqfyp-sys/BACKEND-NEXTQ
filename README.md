# NextQ Backend — Node.js/Express REST API

REST API for the **NextQ Universal Learning Platform**.
Handles Phantom wallet authentication, AI-powered quiz/paper generation, COIN token economics on Solana Devnet, file uploads, and admin operations.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [Environment Variables](#environment-variables)
4. [Local Development](#local-development)
5. [Database Schema](#database-schema)
6. [Authentication & Roles](#authentication--roles)
7. [API Reference](#api-reference)
8. [AI Integration](#ai-integration)
9. [Token Economics](#token-economics)
10. [File Storage](#file-storage)
11. [Rate Limiting](#rate-limiting)
12. [Solana Details](#solana-details)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 20 |
| Framework | Express 4 |
| Database | PostgreSQL via Prisma ORM |
| Cache / Auth | Redis — JWT whitelist/blacklist + rate limiting |
| Blockchain | Solana Devnet, `@solana/web3.js`, `@solana/spl-token` |
| AI | HuggingFace Spaces FastAPI (RAG endpoints) |
| Storage | Cloudinary (PDFs, `resource_type: 'raw'`) |
| Password hashing | bcryptjs (admin/moderator accounts only) |

---

## Project Structure

```
backend/
├── .env                          # Local secrets (never commit)
├── package.json
├── prisma/
│   ├── schema.prisma             # All models + UserRole enum
│   └── migrations/               # Applied SQL migrations
└── src/
    ├── app.js                    # Express setup: BigInt patch, CORS, routes
    ├── server.js                 # Entry — DB + Redis connect, server start
    ├── config/
    │   ├── cloudinary.js         # Cloudinary v2 upload helper
    │   ├── cors.js               # CORS allow-list (FRONTEND_URL)
    │   ├── database.js           # Prisma client singleton
    │   ├── logger.js             # Winston logger
    │   ├── redis.js              # ioredis client
    │   └── solana.js             # Connection, mint keypair, SPL helpers
    ├── controllers/
    │   ├── auth.controller.js          # signup, login, admin-login, refresh, logout, me
    │   ├── adminAuth.controller.js     # adminLogin, adminCreate
    │   ├── quiz.controller.js          # generateQuiz, recordQuiz, submitQuiz, quizHistory
    │   ├── paper.controller.js         # generatePaper, generateUnverified, record*, download, history
    │   ├── upload.controller.js        # submitUpload (AI score → Cloudinary), status, history
    │   ├── token.controller.js         # getBalance, sendTokens, tokenHistory, buyTokens
    │   ├── solana.controller.js        # getBlockhash, prepareTransfer, submitSignedTx
    │   └── admin.controller.js         # stats, users, papers, uploads, transactions, moderator CRUD
    ├── middleware/
    │   ├── authenticate.js       # requireAuth, requireAdmin, requireRole factory
    │   ├── errorHandler.js       # globalErrorHandler, notFoundHandler
    │   ├── rateLimit.js          # Redis-based daily limits + cooldowns
    │   └── upload.js             # multer memoryStorage (max 10 MB)
    ├── models/
    │   ├── user.model.js         # UserModel, BalanceModel
    │   ├── quiz.model.js         # QuizModel
    │   ├── paper.model.js        # PaperModel
    │   ├── upload.model.js       # UploadModel
    │   └── transaction.model.js  # TransactionModel, TokenTransferModel
    ├── routes/
    │   ├── auth.routes.js
    │   ├── quiz.routes.js
    │   ├── paper.routes.js
    │   ├── upload.routes.js
    │   ├── token.routes.js
    │   ├── solana.routes.js
    │   └── admin.routes.js       # Split by role: admin-only vs admin+moderator
    ├── services/
    │   └── ai.service.js         # HF AI proxy: generateVerifiedQuiz, generateVerifiedPaper,
    │                             #   generateUnverifiedPaper, getUnverifiedClasses, scoreUpload
    └── utils/
        ├── AppError.js           # Typed error class with factory methods
        ├── asyncHandler.js       # Async controller wrapper
        ├── tokens.js             # JWT issue/verify/revoke (role in payload)
        └── verifyPhantomSignature.js  # ed25519 signature verification
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | | `3000` | HTTP server port |
| `NODE_ENV` | | `development` | `development` or `production` |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `REDIS_URL` | | `redis://localhost:6379` | Redis URL |
| `ACCESS_TOKEN_SECRET` | ✅ | — | JWT signing secret (min 32 chars) |
| `REFRESH_TOKEN_SECRET` | ✅ | — | Refresh token secret (min 32 chars) |
| `ACCESS_TOKEN_EXPIRY` | | `15m` | Access token TTL |
| `REFRESH_TOKEN_EXPIRY` | | `7d` | Refresh token TTL |
| `ADMIN_WALLET` | ✅ | — | Phantom wallet address that gets `admin` role |
| `FRONTEND_URL` | | `http://localhost:3001` | CORS allowed origin |
| `HF_BASE_URL` | ✅ | — | HuggingFace Space base URL |
| `HF_API_TOKEN` | | — | HuggingFace Bearer token (optional) |
| `SOLANA_RPC_URL` | | `https://api.devnet.solana.com` | Solana RPC |
| `SOLANA_WALLET_PRIVATE_KEY` | | — | Base58 platform keypair (mint authority) |
| `SOLANA_TOKEN_MINT_ADDRESS` | | — | COIN SPL mint address |
| `CLOUDINARY_CLOUD_NAME` | | — | Cloudinary credential |
| `CLOUDINARY_API_KEY` | | — | Cloudinary credential |
| `CLOUDINARY_API_SECRET` | | — | Cloudinary credential |
| `APITEMPLATE_API_KEY` | | — | APITemplate.io key (PDF generation) |

---

## Local Development

```bash
cd backend
npm install
cp .env.example .env      # fill DATABASE_URL, secrets, ADMIN_WALLET, HF_BASE_URL

npx prisma db push        # sync schema to DB
npx prisma generate       # regenerate Prisma client

# Start Redis
sudo service redis-server start   # Linux/WSL

npm run dev               # nodemon on :3000
```

---

## Database Schema

### Tables

| Table | Key columns |
|---|---|
| `users` | `id UUID`, `wallet_address?`, `username?`, `password_hash?`, `role UserRole`, `signup_bonus_granted` |
| `balances` | `user_id FK`, `token_balance BigInt` |
| `refresh_tokens` | `user_id FK`, `token_hash`, `expires_at`, `revoked` |
| `quizzes` | `user_id`, `subject`, `questions JSON`, `answers JSON?`, `score Decimal?`, `tokens_spent BigInt` |
| `papers` | `user_id`, `subject`, `paper_payload JSON?`, `download_url?`, `tokens_spent BigInt` |
| `uploads` | `user_id`, `filename`, `storage_path`, `status`, `ai_score Decimal?`, `reward_tokens BigInt` |
| `transactions` | `from_user_id?`, `to_user_id?`, `amount BigInt`, `tx_type`, `reference_id?`, `note?` |
| `token_transfers` | `sender_user_id`, `recipient_user_id`, `amount BigInt`, `transaction_id?` |

### UserRole enum

- `student` — default for all Phantom wallet signups
- `admin` — wallet matches `ADMIN_WALLET` env var, or created via `/api/auth/admin-create`
- `content_moderator` — created via `POST /api/admin/moderators`

### Gotchas

- Prisma returns native `BigInt` for `token_balance`, `tokens_spent`, `reward_tokens`, `amount`. `app.js` patches `BigInt.prototype.toJSON` to serialize these as `Number`.
- `wallet_address` is nullable — admin/mod credential accounts have `null` wallet.
- Always run `npx prisma generate` after any `schema.prisma` change.

---

## Authentication & Roles

### Student flow (Phantom wallet)

```
POST /api/auth/signup  { wallet_address, signed_message, signature }
  → backend verifies ed25519 signature
  → role = 'admin' if wallet === ADMIN_WALLET, else 'student'
  → sets httpOnly JWT cookies (access: 15min, refresh: 7d)
  → returns { role, redirect_to }
```

### Admin/Moderator flow (credentials)

```
POST /api/auth/admin-login  { username, password }
  → bcrypt.compare(password, password_hash)
  → sets httpOnly JWT cookies
  → returns { role, redirect_to: '/dashboard/admin' }
```

### Middleware chain

```javascript
requireAuth              // verifies access_token cookie → req.userId, req.userRole
requireAdmin             // req.userRole === 'admin'
requireRole('admin', 'content_moderator')  // generic role guard
```

### Admin routes split

- `GET /api/admin/stats|papers|uploads` — accessible by **admin + content_moderator**
- `GET /api/admin/users|transactions` + all moderator CRUD — **admin only**

---

## API Reference

All protected routes require the `access_token` httpOnly cookie.

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/signup` | No | Phantom signup/login |
| POST | `/api/auth/login` | No | Phantom login |
| POST | `/api/auth/admin-login` | No | Credential login (admin/mod) |
| POST | `/api/auth/refresh` | No | Rotate token pair |
| POST | `/api/auth/logout` | No | Revoke + clear cookies |
| GET | `/api/auth/me` | Yes | Current user + balance (strips `password_hash`) |

### Quiz

| Method | Path | Cost | Description |
|---|---|---|---|
| POST | `/api/quiz/generate` | −5 COIN | DB-only fallback (calls HF AI, deducts DB balance) |
| POST | `/api/quiz/record` | — | Record row after on-chain Phantom burn |
| POST | `/api/quiz/submit` | — | Submit answers + score |
| GET | `/api/quiz/history` | — | Paginated history |

`generate` body: `{ subject, category?, class?, country?, number_of_mcqs?, preference? }`

### Paper

| Method | Path | Cost | Description |
|---|---|---|---|
| POST | `/api/paper/generate` | −5 COIN | Calls HF `/verified/generate-paper/boards`, stores payload in DB |
| POST | `/api/paper/generate-unverified` | −2 COIN | Calls HF `/unverified/generate-paper`, stores payload |
| POST | `/api/paper/record` | — | Record after on-chain burn; accepts optional `paper_payload` |
| POST | `/api/paper/record-unverified` | — | Record community paper; accepts optional `paper_payload` |
| GET | `/api/paper/download/:paperId` | — | Returns paper with full `paper_payload` JSON |
| GET | `/api/paper/history` | — | Paginated history |

`generate` body: `{ subject, category?, class?, country?, mcqs?, short_questions?, long_questions?, preference? }`

### Upload

| Method | Path | Reward | Description |
|---|---|---|---|
| POST | `/api/upload/submit` | 0–50 COIN | Multipart PDF → HF scoring → conditional Cloudinary |
| GET | `/api/upload/status/:id` | — | Upload status |
| GET | `/api/upload/history` | — | Paginated history |

### Token

| Method | Path | Description |
|---|---|---|
| GET | `/api/token/balance` | COIN balance |
| POST | `/api/token/send` | Send COIN to registered wallet |
| GET | `/api/token/history` | Transactions + peer transfers |
| POST | `/api/token/buy` | Buy COIN ($1 = 5 COIN) |
| POST | `/api/token/submit-signed-tx` | Submit Phantom-signed burn/transfer tx |

### Solana

| Method | Path | Description |
|---|---|---|
| GET | `/api/solana/blockhash` | Fresh blockhash for client tx building |
| POST | `/api/solana/prepare-transfer` | Ensure recipient ATA exists |

### Admin

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/admin/stats` | admin + mod | KPIs, 7-day chart, token supply |
| GET | `/api/admin/users` | admin | Paginated users with role badges |
| GET | `/api/admin/papers` | admin + mod | Papers + per-subject histogram |
| GET | `/api/admin/uploads` | admin + mod | Upload history |
| GET | `/api/admin/transactions` | admin | Platform transactions |
| POST | `/api/admin/moderators` | admin | Create content_moderator account |
| DELETE | `/api/admin/moderators/:id` | admin | Delete moderator |
| POST | `/api/admin/moderators/:id/reset-password` | admin | Change moderator password |

---

## AI Integration

Base URL: `https://ekrash1234-github-deploy-token.hf.space`

All calls are made from `src/services/ai.service.js` with static fallbacks for cold starts.

| Service function | HF endpoint | Used by |
|---|---|---|
| `generateVerifiedQuiz(params)` | `POST /verified/generate-quiz` | `quiz.controller` |
| `generateVerifiedPaper(params)` | `POST /verified/generate-paper/boards` | `paper.controller` |
| `generateUnverifiedPaper(params)` | `POST /unverified/generate-paper` | `paper.controller` |
| `getUnverifiedClasses()` | `GET /unverified/classes` | (direct frontend call) |
| `scoreUpload(buffer, filename, ...)` | `POST /unverified/upload-paper` | `upload.controller` |

**Verified categories:** `"Punjab Boards"` · `"Cambridge"` · `"Federal Boards"`  
Cambridge papers use the same `/boards` endpoint with `category: "Cambridge"`.

---

## Token Economics

| Event | COIN | On-chain |
|---|---|---|
| Sign up | +20 | ✅ Mint |
| Quiz (fallback) | −5 | DB only |
| Quiz (Phantom) | −5 | ✅ Burn |
| Verified paper | −5 | ✅ Burn |
| Community paper | −2 | ✅ Burn |
| Upload (accepted) | +floor(score) | ✅ Mint |
| Buy credits | +5×USD | ✅ Mint |
| Send COIN | −amount | ✅ Transfer |

---

## File Storage

- Uploads are stored in Cloudinary **only when `ai_score > 0`**
- Zero-score files are recorded in DB only — no storage cost
- If Cloudinary is not configured, uploads still work (DB record only)

---

## Rate Limiting

Per-user Redis counters. Skipped gracefully if Redis is down.

| Endpoint | Limit | Window |
|---|---|---|
| `POST /api/quiz/generate` | 20 req | per day |
| `POST /api/quiz/generate` | 1 req | 30s cooldown |
| `POST /api/paper/generate*` | 10 req | per day |
| `POST /api/upload/submit` | 5 req | per day |
| `POST /api/token/send` | 50 req | per day |
| `POST /api/token/buy` | 5 req | per hour |

---

## Solana Details

| Item | Value |
|---|---|
| Network | Devnet |
| Program ID | `HHfqXJ9sZNNRJZGonfinA8gNY7vLpJ9tyrFQ4eAiQsgK` |
| COIN Mint | `2YQFHTscEGsNzCbyVDGDdhFDvtNGcaAvBVK97NWDCGBg` |
| Decimals | 2 (1 COIN = 100 raw units) |
| Mint Authority | Platform wallet (`SOLANA_WALLET_PRIVATE_KEY`) |
