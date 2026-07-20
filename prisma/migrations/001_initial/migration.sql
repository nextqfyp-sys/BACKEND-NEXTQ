-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateTable: users
CREATE TABLE IF NOT EXISTS "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "wallet_address" TEXT NOT NULL,
    "email" TEXT,
    "signup_bonus_granted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "users_wallet_address_key" ON "users"("wallet_address");
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");

-- CreateTable: balances
CREATE TABLE IF NOT EXISTS "balances" (
    "user_id" UUID NOT NULL,
    "token_balance" BIGINT NOT NULL DEFAULT 0 CHECK ("token_balance" >= 0),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "balances_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "balances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

-- CreateTable: refresh_tokens
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateTable: quizzes
CREATE TABLE IF NOT EXISTS "quizzes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "answers" JSONB,
    "score" DECIMAL(5,2),
    "tokens_spent" BIGINT NOT NULL DEFAULT 5 CHECK ("tokens_spent" >= 0),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quizzes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "quizzes_user_id_created_at_idx" ON "quizzes"("user_id", "created_at" DESC);

-- CreateTable: papers
CREATE TABLE IF NOT EXISTS "papers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "paper_payload" JSONB,
    "download_url" TEXT,
    "tokens_spent" BIGINT NOT NULL DEFAULT 5 CHECK ("tokens_spent" >= 0),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "papers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "papers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "papers_user_id_created_at_idx" ON "papers"("user_id", "created_at" DESC);

-- CreateTable: uploads
CREATE TABLE IF NOT EXISTS "uploads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "ai_score" DECIMAL(5,2),
    "reward_tokens" BIGINT NOT NULL DEFAULT 0 CHECK ("reward_tokens" >= 0),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "uploads_user_id_created_at_idx" ON "uploads"("user_id", "created_at" DESC);

-- CreateTable: transactions
CREATE TABLE IF NOT EXISTS "transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "from_user_id" UUID,
    "to_user_id" UUID,
    "amount" BIGINT NOT NULL CHECK ("amount" >= 0),
    "tx_type" TEXT NOT NULL,
    "reference_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transactions_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
    CONSTRAINT "transactions_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "transactions_from_user_id_created_at_idx" ON "transactions"("from_user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "transactions_to_user_id_created_at_idx" ON "transactions"("to_user_id", "created_at" DESC);

-- CreateTable: token_transfers
CREATE TABLE IF NOT EXISTS "token_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sender_user_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL CHECK ("amount" > 0),
    "transaction_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "token_transfers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "token_transfers_sender_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "token_transfers_recipient_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "token_transfers_transaction_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL,
    CONSTRAINT "chk_no_self_transfer" CHECK ("sender_user_id" <> "recipient_user_id")
);
CREATE INDEX IF NOT EXISTS "token_transfers_sender_created_at_idx" ON "token_transfers"("sender_user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "token_transfers_recipient_created_at_idx" ON "token_transfers"("recipient_user_id", "created_at" DESC);
