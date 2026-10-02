-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPERADMIN', 'MARATHON_ADMIN', 'CLUB_ADMIN', 'PRODUCTION_OPERATOR', 'SUPPORT', 'CONTENT_AGENCY', 'SPONSOR');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('GLOBAL', 'ORGANIZATION', 'CLUB', 'CAMPAIGN');

-- CreateEnum
CREATE TYPE "JerseyEdition" AS ENUM ('HOME', 'AWAY', 'THIRD', 'GOALKEEPER', 'SPECIAL', 'COMMEMORATIVE');

-- CreateEnum
CREATE TYPE "ProductionOrderState" AS ENUM ('DRAFT', 'OPEN', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChipType" AS ENUM ('NTAG213', 'NTAG215', 'NTAG216', 'NTAG424DNA', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ChipState" AS ENUM ('RECEIVED', 'VALIDATED', 'RESERVED', 'PERSONALIZING', 'PROGRAMMED', 'VERIFIED', 'LINKED', 'READY_FOR_HEAT_PRESS', 'POST_PRESS_PASSED', 'ACTIVATED', 'QUARANTINED', 'REVOKED', 'DESTROYED');

-- CreateEnum
CREATE TYPE "JerseyUnitState" AS ENUM ('PLANNED', 'IN_PRODUCTION', 'READY', 'ACTIVATED', 'SOLD', 'QUARANTINED', 'REVOKED');

-- CreateEnum
CREATE TYPE "UnitCondition" AS ENUM ('NEW', 'GIFTED', 'USED', 'TRANSFERRED', 'COLLECTION');

-- CreateEnum
CREATE TYPE "PersonalizationJobState" AS ENUM ('PENDING', 'IN_PROGRESS', 'WRITTEN', 'VERIFIED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TrustLevel" AS ENUM ('VERIFIED', 'IDENTIFIED_ONLY', 'SUSPICIOUS', 'UNVERIFIABLE', 'REVOKED', 'NOT_ACTIVATED');

-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('NFC_CRYPTOGRAPHIC', 'NFC_STATIC_URL', 'QR_CODE', 'MANUAL_LOOKUP');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "RiskAlertState" AS ENUM ('OPEN', 'IN_REVIEW', 'CONFIRMED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "TransferState" AS ENUM ('PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ContentKind" AS ENUM ('HERO', 'STORY', 'VIDEO', 'QUIZ', 'POLL', 'REWARD_TEASER', 'SPONSOR_MESSAGE', 'MATCH_CARD', 'CARE_INSTRUCTIONS');

-- CreateEnum
CREATE TYPE "MatchPhase" AS ENUM ('UPCOMING', 'LIVE', 'FINISHED');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('MARKETING', 'LOCATION', 'SPONSOR_ANALYTICS', 'PERSONALIZATION', 'CLUB_COMMUNICATIONS');

-- CreateEnum
CREATE TYPE "PrivacyRequestType" AS ENUM ('ACCESS', 'RECTIFICATION', 'DELETION', 'OPPOSITION', 'PORTABILITY', 'CONSENT_WITHDRAWAL');

-- CreateEnum
CREATE TYPE "PrivacyRequestState" AS ENUM ('RECEIVED', 'IDENTITY_PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SupportCaseState" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecretRef" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "scopeType" "ScopeType" NOT NULL DEFAULT 'GLOBAL',
    "scopeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastIpPrefix" TEXT,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'EC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Club" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "crestAssetPath" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#0B3D2E',
    "secondaryColor" TEXT NOT NULL DEFAULT '#F5F5F5',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "seasonId" TEXT,
    "fullName" TEXT NOT NULL,
    "shirtNumber" INTEGER,
    "position" TEXT,
    "portraitPath" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JerseyModel" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "edition" "JerseyEdition" NOT NULL DEFAULT 'HOME',
    "description" TEXT,
    "imagePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "JerseyModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sku" (
    "id" TEXT NOT NULL,
    "jerseyModelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "fit" TEXT NOT NULL DEFAULT 'REGULAR',
    "priceCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "state" "ProductionOrderState" NOT NULL DEFAULT 'DRAFT',
    "plannedUnits" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionBatch" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT,
    "code" TEXT NOT NULL,
    "supplierName" TEXT,
    "supplierLotRef" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "flagReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgrammingStation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgrammingStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorizedDevice" (
    "id" TEXT NOT NULL,
    "stationId" TEXT,
    "deviceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "model" TEXT,
    "osVersion" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "attestationRef" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "primaryOperatorId" TEXT,

    CONSTRAINT "AuthorizedDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NfcChip" (
    "id" TEXT NOT NULL,
    "batchId" TEXT,
    "uid" TEXT NOT NULL,
    "chipType" "ChipType" NOT NULL DEFAULT 'UNKNOWN',
    "state" "ChipState" NOT NULL DEFAULT 'RECEIVED',
    "tagTokenHash" TEXT,
    "programmedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "lastAcceptedCounter" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NfcChip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NfcKeyReference" (
    "id" TEXT NOT NULL,
    "chipId" TEXT NOT NULL,
    "keyRole" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "custodian" TEXT NOT NULL DEFAULT 'none',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "NfcKeyReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Emblem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT,
    "chipId" TEXT,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CREST',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Emblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JerseyUnit" (
    "id" TEXT NOT NULL,
    "jerseyModelId" TEXT NOT NULL,
    "skuId" TEXT,
    "playerId" TEXT,
    "emblemId" TEXT,
    "productionOrderId" TEXT,
    "publicRef" TEXT NOT NULL,
    "qrTokenHash" TEXT,
    "qrRotatedAt" TIMESTAMP(3),
    "qrExpiresAt" TIMESTAMP(3),
    "state" "JerseyUnitState" NOT NULL DEFAULT 'PLANNED',
    "condition" "UnitCondition" NOT NULL DEFAULT 'NEW',
    "shirtNumber" INTEGER,
    "playerNameOnShirt" TEXT,
    "activatedAt" TIMESTAMP(3),
    "soldAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "interactionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "JerseyUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostPressCheck" (
    "id" TEXT NOT NULL,
    "jerseyUnitId" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "readable" BOOLEAN NOT NULL,
    "contentIntact" BOOLEAN NOT NULL,
    "temperatureC" INTEGER,
    "pressureBar" DECIMAL(6,2),
    "durationSec" INTEGER,
    "operatorId" TEXT,
    "deviceId" TEXT,
    "providerId" TEXT NOT NULL,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostPressCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalizationJob" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "chipId" TEXT,
    "operatorId" TEXT NOT NULL,
    "deviceId" TEXT,
    "stationId" TEXT,
    "state" "PersonalizationJobState" NOT NULL DEFAULT 'PENDING',
    "providerId" TEXT NOT NULL,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT NOT NULL,
    "targetUri" TEXT,
    "writtenPayloadHash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalizationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationEvent" (
    "id" TEXT NOT NULL,
    "jerseyUnitId" TEXT,
    "chipId" TEXT,
    "method" "VerificationMethod" NOT NULL,
    "trustLevel" "TrustLevel" NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "reasonCodes" TEXT NOT NULL DEFAULT '',
    "reportedCounter" INTEGER,
    "messageFingerprint" TEXT,
    "ipPseudonym" TEXT,
    "deviceFingerprint" TEXT,
    "countryCode" TEXT,
    "language" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAlert" (
    "id" TEXT NOT NULL,
    "jerseyUnitId" TEXT,
    "verificationEventId" TEXT,
    "state" "RiskAlertState" NOT NULL DEFAULT 'OPEN',
    "riskLevel" "RiskLevel" NOT NULL,
    "reasonCodes" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "reviewNotes" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FanAccount" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "displayName" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'es',
    "emailVerifiedAt" TIMESTAMP(3),
    "loyaltyTier" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "FanAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FanSession" (
    "id" TEXT NOT NULL,
    "fanId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FanSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ownership" (
    "id" TEXT NOT NULL,
    "jerseyUnitId" TEXT NOT NULL,
    "fanId" TEXT NOT NULL,
    "acquiredVia" TEXT NOT NULL DEFAULT 'CLAIM',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ownership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnershipTransfer" (
    "id" TEXT NOT NULL,
    "jerseyUnitId" TEXT NOT NULL,
    "fromFanId" TEXT NOT NULL,
    "toFanId" TEXT,
    "toEmail" TEXT,
    "state" "TransferState" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnershipTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigitalCertificate" (
    "id" TEXT NOT NULL,
    "jerseyUnitId" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "formatVersion" INTEGER NOT NULL DEFAULT 1,
    "signature" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DigitalCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "clubId" TEXT,
    "campaignId" TEXT,
    "kind" "ContentKind" NOT NULL DEFAULT 'STORY',
    "title" JSONB NOT NULL,
    "body" JSONB NOT NULL,
    "mediaUrl" TEXT,
    "mediaAlt" JSONB,
    "captionsUrl" TEXT,
    "ctaLabel" JSONB,
    "ctaHref" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "estimatedMediaBytes" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentRule" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "activeFrom" TIMESTAMP(3),
    "activeUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "opponent" TEXT NOT NULL,
    "kickoffAt" TIMESTAMP(3) NOT NULL,
    "venue" TEXT,
    "isHome" BOOLEAN NOT NULL DEFAULT true,
    "phase" "MatchPhase" NOT NULL DEFAULT 'UPCOMING',
    "goalsFor" INTEGER,
    "goalsAgainst" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sponsor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoPath" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sponsor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "sponsorId" TEXT,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignMetric" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "bucketDate" DATE NOT NULL,
    "value" INTEGER NOT NULL,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reward" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'CONTENT_UNLOCK',
    "minTrustLevel" "TrustLevel" NOT NULL DEFAULT 'IDENTIFIED_ONLY',
    "requiresAccount" BOOLEAN NOT NULL DEFAULT true,
    "stock" INTEGER,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardRedemption" (
    "id" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "fanId" TEXT NOT NULL,
    "jerseyUnitId" TEXT,
    "codeHash" TEXT,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "fanId" TEXT NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "grantedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "policyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyRequest" (
    "id" TEXT NOT NULL,
    "fanId" TEXT,
    "email" TEXT NOT NULL,
    "type" "PrivacyRequestType" NOT NULL,
    "state" "PrivacyRequestState" NOT NULL DEFAULT 'RECEIVED',
    "details" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportCase" (
    "id" TEXT NOT NULL,
    "jerseyUnitId" TEXT,
    "fanId" TEXT,
    "contactEmail" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "state" "SupportCaseState" NOT NULL DEFAULT 'OPEN',
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assigneeId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'USER',
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipPrefix" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsDaily" (
    "id" TEXT NOT NULL,
    "bucketDate" DATE NOT NULL,
    "event" TEXT NOT NULL,
    "clubId" TEXT,
    "jerseyModelId" TEXT,
    "trustLevel" "TrustLevel",
    "countryCode" TEXT,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_active_idx" ON "User"("active");

-- CreateIndex
CREATE INDEX "RoleAssignment_userId_idx" ON "RoleAssignment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RoleAssignment_userId_role_scopeType_scopeId_key" ON "RoleAssignment"("userId", "role", "scopeType", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");

-- CreateIndex
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_name_key" ON "Organization"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Club_slug_key" ON "Club"("slug");

-- CreateIndex
CREATE INDEX "Club_organizationId_idx" ON "Club"("organizationId");

-- CreateIndex
CREATE INDEX "Season_clubId_idx" ON "Season"("clubId");

-- CreateIndex
CREATE UNIQUE INDEX "Season_clubId_name_key" ON "Season"("clubId", "name");

-- CreateIndex
CREATE INDEX "Player_clubId_seasonId_idx" ON "Player"("clubId", "seasonId");

-- CreateIndex
CREATE INDEX "JerseyModel_clubId_idx" ON "JerseyModel"("clubId");

-- CreateIndex
CREATE UNIQUE INDEX "JerseyModel_clubId_seasonId_name_edition_key" ON "JerseyModel"("clubId", "seasonId", "name", "edition");

-- CreateIndex
CREATE UNIQUE INDEX "Sku_code_key" ON "Sku"("code");

-- CreateIndex
CREATE INDEX "Sku_jerseyModelId_idx" ON "Sku"("jerseyModelId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOrder_code_key" ON "ProductionOrder"("code");

-- CreateIndex
CREATE INDEX "ProductionOrder_state_idx" ON "ProductionOrder"("state");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionBatch_code_key" ON "ProductionBatch"("code");

-- CreateIndex
CREATE INDEX "ProductionBatch_productionOrderId_idx" ON "ProductionBatch"("productionOrderId");

-- CreateIndex
CREATE INDEX "ProductionBatch_flagged_idx" ON "ProductionBatch"("flagged");

-- CreateIndex
CREATE UNIQUE INDEX "ProgrammingStation_code_key" ON "ProgrammingStation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorizedDevice_deviceId_key" ON "AuthorizedDevice"("deviceId");

-- CreateIndex
CREATE INDEX "AuthorizedDevice_active_idx" ON "AuthorizedDevice"("active");

-- CreateIndex
CREATE UNIQUE INDEX "NfcChip_uid_key" ON "NfcChip"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "NfcChip_tagTokenHash_key" ON "NfcChip"("tagTokenHash");

-- CreateIndex
CREATE INDEX "NfcChip_state_idx" ON "NfcChip"("state");

-- CreateIndex
CREATE INDEX "NfcChip_batchId_idx" ON "NfcChip"("batchId");

-- CreateIndex
CREATE INDEX "NfcKeyReference_chipId_idx" ON "NfcKeyReference"("chipId");

-- CreateIndex
CREATE UNIQUE INDEX "NfcKeyReference_chipId_keyRole_version_key" ON "NfcKeyReference"("chipId", "keyRole", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Emblem_chipId_key" ON "Emblem"("chipId");

-- CreateIndex
CREATE UNIQUE INDEX "Emblem_code_key" ON "Emblem"("code");

-- CreateIndex
CREATE INDEX "Emblem_batchId_idx" ON "Emblem"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "JerseyUnit_emblemId_key" ON "JerseyUnit"("emblemId");

-- CreateIndex
CREATE UNIQUE INDEX "JerseyUnit_publicRef_key" ON "JerseyUnit"("publicRef");

-- CreateIndex
CREATE UNIQUE INDEX "JerseyUnit_qrTokenHash_key" ON "JerseyUnit"("qrTokenHash");

-- CreateIndex
CREATE INDEX "JerseyUnit_state_idx" ON "JerseyUnit"("state");

-- CreateIndex
CREATE INDEX "JerseyUnit_jerseyModelId_idx" ON "JerseyUnit"("jerseyModelId");

-- CreateIndex
CREATE INDEX "JerseyUnit_productionOrderId_idx" ON "JerseyUnit"("productionOrderId");

-- CreateIndex
CREATE INDEX "PostPressCheck_jerseyUnitId_idx" ON "PostPressCheck"("jerseyUnitId");

-- CreateIndex
CREATE INDEX "PostPressCheck_passed_idx" ON "PostPressCheck"("passed");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalizationJob_idempotencyKey_key" ON "PersonalizationJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PersonalizationJob_productionOrderId_idx" ON "PersonalizationJob"("productionOrderId");

-- CreateIndex
CREATE INDEX "PersonalizationJob_state_idx" ON "PersonalizationJob"("state");

-- CreateIndex
CREATE INDEX "PersonalizationJob_chipId_idx" ON "PersonalizationJob"("chipId");

-- CreateIndex
CREATE INDEX "VerificationEvent_jerseyUnitId_createdAt_idx" ON "VerificationEvent"("jerseyUnitId", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationEvent_createdAt_idx" ON "VerificationEvent"("createdAt");

-- CreateIndex
CREATE INDEX "VerificationEvent_trustLevel_idx" ON "VerificationEvent"("trustLevel");

-- CreateIndex
CREATE INDEX "VerificationEvent_messageFingerprint_idx" ON "VerificationEvent"("messageFingerprint");

-- CreateIndex
CREATE INDEX "RiskAlert_state_idx" ON "RiskAlert"("state");

-- CreateIndex
CREATE INDEX "RiskAlert_riskLevel_idx" ON "RiskAlert"("riskLevel");

-- CreateIndex
CREATE INDEX "RiskAlert_jerseyUnitId_idx" ON "RiskAlert"("jerseyUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "FanAccount_email_key" ON "FanAccount"("email");

-- CreateIndex
CREATE INDEX "FanAccount_email_idx" ON "FanAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "FanSession_tokenHash_key" ON "FanSession"("tokenHash");

-- CreateIndex
CREATE INDEX "FanSession_fanId_idx" ON "FanSession"("fanId");

-- CreateIndex
CREATE INDEX "FanSession_expiresAt_idx" ON "FanSession"("expiresAt");

-- CreateIndex
CREATE INDEX "Ownership_jerseyUnitId_idx" ON "Ownership"("jerseyUnitId");

-- CreateIndex
CREATE INDEX "Ownership_fanId_idx" ON "Ownership"("fanId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnershipTransfer_tokenHash_key" ON "OwnershipTransfer"("tokenHash");

-- CreateIndex
CREATE INDEX "OwnershipTransfer_jerseyUnitId_idx" ON "OwnershipTransfer"("jerseyUnitId");

-- CreateIndex
CREATE INDEX "OwnershipTransfer_state_idx" ON "OwnershipTransfer"("state");

-- CreateIndex
CREATE INDEX "OwnershipTransfer_expiresAt_idx" ON "OwnershipTransfer"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DigitalCertificate_jerseyUnitId_key" ON "DigitalCertificate"("jerseyUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "DigitalCertificate_serial_key" ON "DigitalCertificate"("serial");

-- CreateIndex
CREATE INDEX "ContentItem_clubId_idx" ON "ContentItem"("clubId");

-- CreateIndex
CREATE INDEX "ContentItem_active_idx" ON "ContentItem"("active");

-- CreateIndex
CREATE INDEX "ContentRule_contentItemId_idx" ON "ContentRule"("contentItemId");

-- CreateIndex
CREATE INDEX "Match_clubId_kickoffAt_idx" ON "Match"("clubId", "kickoffAt");

-- CreateIndex
CREATE INDEX "Sponsor_organizationId_idx" ON "Sponsor"("organizationId");

-- CreateIndex
CREATE INDEX "Campaign_sponsorId_idx" ON "Campaign"("sponsorId");

-- CreateIndex
CREATE INDEX "Campaign_active_idx" ON "Campaign"("active");

-- CreateIndex
CREATE INDEX "CampaignMetric_campaignId_idx" ON "CampaignMetric"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMetric_campaignId_metricKey_bucketDate_key" ON "CampaignMetric"("campaignId", "metricKey", "bucketDate");

-- CreateIndex
CREATE INDEX "Reward_campaignId_idx" ON "Reward"("campaignId");

-- CreateIndex
CREATE INDEX "Reward_active_idx" ON "Reward"("active");

-- CreateIndex
CREATE INDEX "RewardRedemption_fanId_idx" ON "RewardRedemption"("fanId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRedemption_rewardId_fanId_jerseyUnitId_key" ON "RewardRedemption"("rewardId", "fanId", "jerseyUnitId");

-- CreateIndex
CREATE INDEX "Consent_fanId_idx" ON "Consent"("fanId");

-- CreateIndex
CREATE UNIQUE INDEX "Consent_fanId_purpose_key" ON "Consent"("fanId", "purpose");

-- CreateIndex
CREATE INDEX "PrivacyRequest_state_idx" ON "PrivacyRequest"("state");

-- CreateIndex
CREATE INDEX "PrivacyRequest_dueAt_idx" ON "PrivacyRequest"("dueAt");

-- CreateIndex
CREATE INDEX "SupportCase_state_idx" ON "SupportCase"("state");

-- CreateIndex
CREATE INDEX "SupportCase_jerseyUnitId_idx" ON "SupportCase"("jerseyUnitId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_idx" ON "AuditEvent"("actorId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_key_key" ON "IdempotencyRecord"("key");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE INDEX "AnalyticsDaily_bucketDate_idx" ON "AnalyticsDaily"("bucketDate");

-- CreateIndex
CREATE INDEX "AnalyticsDaily_event_idx" ON "AnalyticsDaily"("event");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDaily_bucketDate_event_clubId_jerseyModelId_trustL_key" ON "AnalyticsDaily"("bucketDate", "event", "clubId", "jerseyModelId", "trustLevel", "countryCode");

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "AuthorizedDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Club" ADD CONSTRAINT "Club_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JerseyModel" ADD CONSTRAINT "JerseyModel_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JerseyModel" ADD CONSTRAINT "JerseyModel_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sku" ADD CONSTRAINT "Sku_jerseyModelId_fkey" FOREIGN KEY ("jerseyModelId") REFERENCES "JerseyModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorizedDevice" ADD CONSTRAINT "AuthorizedDevice_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "ProgrammingStation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorizedDevice" ADD CONSTRAINT "AuthorizedDevice_primaryOperatorId_fkey" FOREIGN KEY ("primaryOperatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NfcChip" ADD CONSTRAINT "NfcChip_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NfcKeyReference" ADD CONSTRAINT "NfcKeyReference_chipId_fkey" FOREIGN KEY ("chipId") REFERENCES "NfcChip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Emblem" ADD CONSTRAINT "Emblem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Emblem" ADD CONSTRAINT "Emblem_chipId_fkey" FOREIGN KEY ("chipId") REFERENCES "NfcChip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JerseyUnit" ADD CONSTRAINT "JerseyUnit_jerseyModelId_fkey" FOREIGN KEY ("jerseyModelId") REFERENCES "JerseyModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JerseyUnit" ADD CONSTRAINT "JerseyUnit_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JerseyUnit" ADD CONSTRAINT "JerseyUnit_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JerseyUnit" ADD CONSTRAINT "JerseyUnit_emblemId_fkey" FOREIGN KEY ("emblemId") REFERENCES "Emblem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JerseyUnit" ADD CONSTRAINT "JerseyUnit_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostPressCheck" ADD CONSTRAINT "PostPressCheck_jerseyUnitId_fkey" FOREIGN KEY ("jerseyUnitId") REFERENCES "JerseyUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalizationJob" ADD CONSTRAINT "PersonalizationJob_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalizationJob" ADD CONSTRAINT "PersonalizationJob_chipId_fkey" FOREIGN KEY ("chipId") REFERENCES "NfcChip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalizationJob" ADD CONSTRAINT "PersonalizationJob_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalizationJob" ADD CONSTRAINT "PersonalizationJob_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "AuthorizedDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalizationJob" ADD CONSTRAINT "PersonalizationJob_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "ProgrammingStation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEvent" ADD CONSTRAINT "VerificationEvent_jerseyUnitId_fkey" FOREIGN KEY ("jerseyUnitId") REFERENCES "JerseyUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEvent" ADD CONSTRAINT "VerificationEvent_chipId_fkey" FOREIGN KEY ("chipId") REFERENCES "NfcChip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAlert" ADD CONSTRAINT "RiskAlert_jerseyUnitId_fkey" FOREIGN KEY ("jerseyUnitId") REFERENCES "JerseyUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAlert" ADD CONSTRAINT "RiskAlert_verificationEventId_fkey" FOREIGN KEY ("verificationEventId") REFERENCES "VerificationEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FanSession" ADD CONSTRAINT "FanSession_fanId_fkey" FOREIGN KEY ("fanId") REFERENCES "FanAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ownership" ADD CONSTRAINT "Ownership_jerseyUnitId_fkey" FOREIGN KEY ("jerseyUnitId") REFERENCES "JerseyUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ownership" ADD CONSTRAINT "Ownership_fanId_fkey" FOREIGN KEY ("fanId") REFERENCES "FanAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipTransfer" ADD CONSTRAINT "OwnershipTransfer_jerseyUnitId_fkey" FOREIGN KEY ("jerseyUnitId") REFERENCES "JerseyUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipTransfer" ADD CONSTRAINT "OwnershipTransfer_fromFanId_fkey" FOREIGN KEY ("fromFanId") REFERENCES "FanAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipTransfer" ADD CONSTRAINT "OwnershipTransfer_toFanId_fkey" FOREIGN KEY ("toFanId") REFERENCES "FanAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalCertificate" ADD CONSTRAINT "DigitalCertificate_jerseyUnitId_fkey" FOREIGN KEY ("jerseyUnitId") REFERENCES "JerseyUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRule" ADD CONSTRAINT "ContentRule_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sponsor" ADD CONSTRAINT "Sponsor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "Sponsor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMetric" ADD CONSTRAINT "CampaignMetric_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "Reward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_fanId_fkey" FOREIGN KEY ("fanId") REFERENCES "FanAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_jerseyUnitId_fkey" FOREIGN KEY ("jerseyUnitId") REFERENCES "JerseyUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_fanId_fkey" FOREIGN KEY ("fanId") REFERENCES "FanAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyRequest" ADD CONSTRAINT "PrivacyRequest_fanId_fkey" FOREIGN KEY ("fanId") REFERENCES "FanAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_jerseyUnitId_fkey" FOREIGN KEY ("jerseyUnitId") REFERENCES "JerseyUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_fanId_fkey" FOREIGN KEY ("fanId") REFERENCES "FanAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
