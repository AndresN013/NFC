/*
  Warnings:

  - The `trustLevel` column on the `AnalyticsDaily` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Made the column `clubId` on table `AnalyticsDaily` required. This step will fail if there are existing NULL values in that column.
  - Made the column `jerseyModelId` on table `AnalyticsDaily` required. This step will fail if there are existing NULL values in that column.
  - Made the column `countryCode` on table `AnalyticsDaily` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "VerificationEvent_unit_recent";

-- AlterTable
ALTER TABLE "AnalyticsDaily" ALTER COLUMN "clubId" SET NOT NULL,
ALTER COLUMN "clubId" SET DEFAULT '',
ALTER COLUMN "jerseyModelId" SET NOT NULL,
ALTER COLUMN "jerseyModelId" SET DEFAULT '',
DROP COLUMN "trustLevel",
ADD COLUMN     "trustLevel" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "countryCode" SET NOT NULL,
ALTER COLUMN "countryCode" SET DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDaily_bucketDate_event_clubId_jerseyModelId_trustL_key" ON "AnalyticsDaily"("bucketDate", "event", "clubId", "jerseyModelId", "trustLevel", "countryCode");
