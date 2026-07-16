// Thin REST client. Every error response is the canonical envelope (§5.1); we
// surface the machine `code` so the UI can map it to a toast.
import type {
  JoinResult,
  Tab,
  TabType,
  TransferHistoryItem,
  WorkspaceCreated,
} from "../types/api";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(err?.code ?? "http_error", err?.message ?? res.statusText);
  }
  return body as T;
}

export const api = {
  createWorkspace: (name?: string) =>
    req<WorkspaceCreated>("/api/v1/workspaces", {
      method: "POST",
      body: JSON.stringify({ name: name ?? null }),
    }),

  join: (code: string, deviceId: string, displayName: string, authToken?: string | null) =>
    req<JoinResult>(`/api/v1/workspaces/${code}/join`, {
      method: "POST",
      body: JSON.stringify({
        device_id: deviceId,
        display_name: displayName,
        auth_token: authToken ?? null,
      }),
    }),

  // Tabs are per-device: always scope the list to this device's documents.
  listTabs: (code: string, ownerDeviceId: string) =>
    req<Tab[]>(
      `/api/v1/workspaces/${code}/tabs?owner_device_id=${encodeURIComponent(ownerDeviceId)}`,
    ),

  createTab: (
    code: string,
    input: {
      owner_device_id: string;
      type: TabType;
      title: string;
      content: string;
      language: string | null;
    },
  ) =>
    req<Tab>(`/api/v1/workspaces/${code}/tabs`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateTab: (tabId: string, patch: Partial<Pick<Tab, "title" | "content" | "language">>) =>
    req<Tab>(`/api/v1/tabs/${tabId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteTab: (tabId: string) =>
    req<void>(`/api/v1/tabs/${tabId}`, { method: "DELETE" }),

  history: (code: string, limit = 50) =>
    req<TransferHistoryItem[]>(
      `/api/v1/workspaces/${code}/transfers/history?limit=${limit}`,
    ),
};
