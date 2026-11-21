import { get, getPage, post, put } from '../../api/http'
import type { Role } from '../../api/types'

export interface ShopRow {
  id: string; organizationId: string; name: string; isActive: boolean; organizationIsActive: boolean; country: string | null;
  createdAtUtc: string; updatedAtUtc: string; users: number; branches: number; plan: string | null;
  subscriptionStatus: string | null; expiresAtUtc: string | null;
}
export interface UserRow {
  id: string; shopId: string; shopName: string; email: string; displayName: string; role: Role;
  isActive: boolean; isSuperAdmin: boolean; hasPendingInvitation: boolean;
  lastLoginAtUtc: string | null; createdAtUtc: string; updatedAtUtc: string;
}
export interface SubscriptionRow {
  organizationId: string; shopName: string; plan: string; status: string; provider: string;
  trialEndsAtUtc: string; currentPeriodEndsAtUtc: string | null; amount: number | null; currency: string | null;
  updatedAtUtc: string; externallyManaged: boolean;
}
export interface PlanRow {
  definition: { id: string; name: string; maxBranches: number; modules: string[]; price: number | null; currency: string };
  updatedAtUtc: string | null;
}
export interface AuditRow { id: string; entityId: string; entityType: string; action: string; actorEmail: string | null; dataJson: string | null; createdAtUtc: string }
export interface Dashboard {
  generatedAtUtc: string; shops: number; organizations: number; activeShops: number; users: number;
  activeSubscriptions: number; trials: number; expired: number; expiring: number;
  monthlyRecurringRevenue: { currency: string; amount: number }[]; collectedRevenueAvailable: boolean; revenueNote: string;
  registrations: { month: string; count: number }[]; plans: { plan: string; name: string; count: number }[];
}
export const commandApi = {
  access: () => get<{ role: 'SuperAdmin' }>('/admin/access'),
  dashboard: () => get<Dashboard>('/admin/dashboard'),
  shops: (params: object) => getPage<ShopRow>('/admin/shops', params),
  shop: (id: string) => get<{ shop: ShopRow; branches: ShopRow[]; subscription: SubscriptionRow | null }>(`/admin/shops/${id}`),
  register: (body: object) => post<ShopRow>('/admin/shops', body),
  activate: (id: string, body: object) => post<ShopRow>(`/admin/shops/${id}/activation`, body),
  users: (params: object) => getPage<UserRow>('/admin/users', params),
  invite: (body: object) => post<{ id: string; invitationQueued: boolean }>('/admin/users', body),
  updateUser: (id: string, body: object) => put(`/admin/users/${id}`, body),
  subscriptions: (params: object) => getPage<SubscriptionRow>('/admin/subscriptions', params),
  subscription: (id: string, body: object) => post(`/admin/subscriptions/${id}`, body),
  plans: () => get<{ currency: string; trialDays: number; plans: PlanRow[] }>('/admin/plans'),
  price: (plan: string, body: object) => put(`/admin/plans/${plan}`, body),
  audit: (params: object) => getPage<AuditRow>('/admin/audit', params)
}
