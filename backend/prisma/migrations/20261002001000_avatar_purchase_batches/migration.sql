-- Additive: existing single purchases keep a NULL batch_id.
CREATE TABLE "avatar_purchase_batches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "key" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "avatar_purchase_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "avatar_purchase_batches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "avatar_purchase_batches_user_id_key_key" ON "avatar_purchase_batches"("user_id", "key");
ALTER TABLE "avatar_purchases" ADD COLUMN "batch_id" UUID;
ALTER TABLE "avatar_purchases" ADD CONSTRAINT "avatar_purchases_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "avatar_purchase_batches"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
CREATE INDEX "avatar_purchases_batch_id_idx" ON "avatar_purchases"("batch_id");
