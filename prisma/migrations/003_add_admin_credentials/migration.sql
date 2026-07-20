-- Add username and password_hash columns for admin / content_moderator credential login
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "username"      TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS "password_hash" TEXT;
