-- AlterTable
ALTER TABLE "PrivacyRequest" ADD COLUMN     "deletionExecutedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedById" TEXT;

-- CreateTable
CREATE TABLE "SupportCaseNote" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "visibleToCustomer" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportCaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportCaseNote_caseId_createdAt_idx" ON "SupportCaseNote"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportCase_assigneeId_idx" ON "SupportCase"("assigneeId");

-- AddForeignKey
ALTER TABLE "SupportCaseNote" ADD CONSTRAINT "SupportCaseNote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "SupportCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCaseNote" ADD CONSTRAINT "SupportCaseNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
