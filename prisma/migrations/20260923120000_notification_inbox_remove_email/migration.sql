-- Plan 2309 (docs/implementation/pending/2309-mobile-nav-email-notifications-category-size-plan.md).
--
-- Email is no longer a notification channel (owner, 23 Sep 2026), SMTP loses its on/off switch
-- (it only emails purchase orders to vendors), the dead Product.size column goes, and each user
-- gets a /notifications inbox.
--
-- NOT additive: this drops columns today's deployed code reads. The owner chose one release
-- (plan Q7), so this migration and the code that stops reading them must go live TOGETHER.
-- Snapshot first (`npm run db:snapshot`); there is no down migration.

-- Q6: the EMAIL outbox rows only ever said "email skipped". They must go BEFORE the enum
-- recreate below — the cast to a PUSH-only type fails on any row still holding 'EMAIL'.
DELETE FROM "notification_outbox" WHERE "channel" = 'EMAIL';

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationChannel_new" AS ENUM ('PUSH');
ALTER TABLE "notification_outbox" ALTER COLUMN "channel" TYPE "NotificationChannel_new" USING ("channel"::text::"NotificationChannel_new");
ALTER TYPE "NotificationChannel" RENAME TO "NotificationChannel_old";
ALTER TYPE "NotificationChannel_new" RENAME TO "NotificationChannel";
DROP TYPE "NotificationChannel_old";
COMMIT;

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "size";

-- AlterTable
ALTER TABLE "notification_config" DROP COLUMN "emailEnabled";

-- AlterTable
ALTER TABLE "notification_event_settings" DROP COLUMN "emailEnabled";

-- AlterTable
ALTER TABLE "notification_preferences" DROP COLUMN "email";

-- CreateTable
CREATE TABLE "notification_inbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "refId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_inbox_userId_createdAt_idx" ON "notification_inbox"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "notification_inbox_userId_readAt_idx" ON "notification_inbox"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "notification_inbox" ADD CONSTRAINT "notification_inbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

