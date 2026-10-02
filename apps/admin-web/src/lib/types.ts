/**
 * Formas de respuesta de la API administrativa.
 *
 * Se declaran a mano y en espanol de negocio solo donde la API ya lo hace.
 * Cada tipo corresponde a un endpoint de `apps/api/src/routes/admin.ts`; si la
 * API cambia, el typecheck de las paginas es el primero en quejarse.
 */

import type { Permission, Role, ScopeType } from '@mev/domain/browser';

export interface RoleAssignmentDto {
  role: Role;
  scopeType: ScopeType;
  scopeId: string | null;
}

/** `POST /admin/login` */
export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    mfaEnabled: boolean;
    roles: RoleAssignmentDto[];
  };
}

/** `GET /admin/me` */
export interface MeResponse {
  id: string;
  email: string;
  displayName: string;
  roles: RoleAssignmentDto[];
  permissions: Permission[];
}

/** Envoltorio paginado comun a los listados. */
export interface Paged<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

/** Listados que la API devuelve sin paginar. */
export interface Listed<T> {
  items: T[];
}

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  active: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  roles: RoleAssignmentDto[];
}

export interface ClubRow {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  primaryColor: string | null;
  secondaryColor: string | null;
  seasons: { id: string; name: string; startDate: string; endDate: string }[];
  _count: { jerseyModels: number; players: number };
}

export interface SkuRow {
  id: string;
  code: string;
  size: string;
  fit: string;
  priceCents: number;
}

export interface JerseyModelRow {
  id: string;
  clubId: string;
  name: string;
  edition: string;
  description: string | null;
  club: { name: string; slug: string };
  season: { name: string };
  skus: SkuRow[];
  _count: { units: number };
}

export interface PlayerRow {
  id: string;
  clubId: string;
  fullName: string;
  shirtNumber: number | null;
  position: string | null;
  active: boolean;
}

/** Fila de `GET /admin/units`. La API ya la devuelve aplanada para el CSV. */
export interface UnitRow {
  publicRef: string;
  state: string;
  condition: string;
  club: string;
  season: string;
  model: string;
  edition: string;
  sku: string;
  size: string;
  chipType: string;
  chipState: string;
  /** Enmascarado salvo que el usuario tenga `chips:read`. */
  chipUid: string;
  hasOwner: string;
  interactions: number;
  activatedAt: string;
}

export interface ChipRow {
  id: string;
  uid: string;
  chipType: string;
  state: string;
  batch: string | null;
  batchFlagged: boolean;
  lastAcceptedCounter: number | null;
  programmedAt: string | null;
  activatedAt: string | null;
}

export interface BatchRow {
  id: string;
  productionOrderId: string | null;
  code: string;
  supplierName: string | null;
  supplierLotRef: string | null;
  receivedAt: string;
  flagged: boolean;
  flagReason: string | null;
  _count: { chips: number; emblems: number };
}

export interface OrderRow {
  id: string;
  organizationId: string;
  code: string;
  state: string;
  plannedUnits: number;
  notes: string | null;
  createdAt: string;
  _count: { units: number; jobs: number };
  batches: { id: string; code: string; flagged: boolean }[];
}

export interface DeviceRow {
  id: string;
  deviceId: string;
  label: string;
  model: string | null;
  osVersion: string | null;
  active: boolean;
  station: string | null;
  operator: string | null;
  lastSeenAt: string | null;
  attestationVerified: boolean;
}

export interface AlertRow {
  id: string;
  state: string;
  riskLevel: string;
  reasonCodes: string[];
  summary: string | null;
  unitRef: string | null;
  unitState: string | null;
  method: string | null;
  trustLevel: string | null;
  countryCode: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface SupportCaseRow {
  id: string;
  jerseyUnitId: string | null;
  /** Dato personal: sólo visible con `support:read`. */
  contactEmail: string | null;
  reason: string;
  state: string;
  subject: string;
  description: string | null;
  resolvedAt: string | null;
  createdAt: string;
  jerseyUnit: { publicRef: string } | null;
}

export interface PrivacyRequestRow {
  id: string;
  /** Dato personal: sólo visible con `privacy:read`. */
  email: string | null;
  type: string;
  state: string;
  details: string | null;
  dueAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  createdAt: string;
}

/** Texto multiidioma tal y como lo guarda la API. */
export type LocalizedText = Record<string, string> | null;

export interface ContentRuleRow {
  id: string;
  conditions: unknown;
  activeFrom: string | null;
  activeUntil: string | null;
}

export interface ContentRow {
  id: string;
  clubId: string | null;
  campaignId: string | null;
  kind: string;
  title: LocalizedText;
  body: LocalizedText;
  mediaUrl: string | null;
  mediaAlt: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  priority: number;
  active: boolean;
  rules: ContentRuleRow[];
  club: { name: string } | null;
}

export interface AuditRow {
  createdAt: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  ipPrefix: string;
  metadata: string;
}

/** `GET /admin/analytics/overview` */
export interface OverviewResponse {
  windowDays: number;
  units: { total: number; activated: number; sold: number; quarantined: number };
  chips: { total: number };
  alerts: { open: number };
  verificationsByTrustLevel: Record<string, number>;
  verificationsByMethod: Record<string, number>;
}

/** `GET /admin/analytics/campaign/:id`. Solo agregados; jamas filas de personas. */
export interface CampaignMetricsResponse {
  campaignId: string;
  minCohortSize: number;
  note: string;
  metrics: { metricKey: string; date: string; value: number | null }[];
}
