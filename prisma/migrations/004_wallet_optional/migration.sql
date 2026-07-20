-- Make wallet_address nullable so admin/content_moderator accounts don't need a Phantom wallet
ALTER TABLE "users" ALTER COLUMN "wallet_address" DROP NOT NULL;
