-- Migration 002: Add user_role enum and role column to users table
-- Run this once against your PostgreSQL database.

-- 1. Create the enum type
CREATE TYPE "user_role" AS ENUM ('student', 'admin', 'content_moderator');

-- 2. Add the role column with a default of 'student'
ALTER TABLE "users"
  ADD COLUMN "role" "user_role" NOT NULL DEFAULT 'student';

-- 3. Promote the pre-existing admin wallet to admin role.
--    Replace the wallet address below with your actual admin wallet before running.
--    This UPDATE is idempotent — safe to run multiple times.
UPDATE "users"
SET "role" = 'admin'
WHERE "wallet_address" = current_setting('app.admin_wallet', true);
