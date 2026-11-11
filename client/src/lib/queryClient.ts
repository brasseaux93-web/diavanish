import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { loadKeyring, keyringSnapshot, onKeyringChange, wipeKeyring } from "./keyring";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

/* Session state for this tab. It lives in sessionStorage, which is scoped to
   this origin and this tab, survives a reload, and is wiped when the tab
   closes. window.name is not used because some browsers carry it across
   navigations to other sites. Where sessionStorage is blocked (sandboxed
   iframes), state stays in memory only and a reload signs the tab out. */
const STORE_KEY = "diavanish";
let sessionToken: string | null = null;
let recoveryKey: string | null = null;
let demoMode = false;

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function restore(raw: string | null) {
  if (!raw) return;
  const saved = JSON.parse(raw);
  if (typeof saved.token === "string") sessionToken = saved.token;
  if (typeof saved.recovery === "string") recoveryKey = saved.recovery;
  if (saved.demo === true) demoMode = true;
  if (saved.keys) loadKeyring(saved.keys);
}

try {
  restore(store()?.getItem(STORE_KEY) ?? store()?.getItem("aperture") ?? null);
} catch {
  /* unreadable state: start signed out */
}

/* Earlier builds kept this state in window.name. Move it once, then clear it. */
try {
  const legacy = window.name ? JSON.parse(window.name) : null;
  if (legacy && typeof legacy.__aperture === "string") {
    if (!sessionToken) {
      restore(JSON.stringify({
        token: legacy.__aperture,
        recovery: legacy.__apertureRecovery,
        demo: legacy.__apertureDemo,
        keys: legacy.__apertureKeys,
      }));
    }
    window.name = "";
  }
} catch {
  /* window.name held something else */
}

onKeyringChange(() => persist());
persist();

function persist() {
  const s = store();
  if (!s) return;
  try {
    if (!sessionToken) {
      s.removeItem(STORE_KEY);
      return;
    }
    s.setItem(STORE_KEY, JSON.stringify({
      token: sessionToken,
      ...(recoveryKey ? { recovery: recoveryKey } : {}),
      ...(demoMode ? { demo: true } : {}),
      ...(keyringSnapshot() ? { keys: keyringSnapshot() } : {}),
    }));
  } catch {
    /* storage full or blocked: memory still holds the session */
  }
}

export function setSessionToken(t: string | null, recovery?: string | null, demo?: boolean) {
  sessionToken = t;
  if (recovery !== undefined) recoveryKey = recovery;
  if (!t) { recoveryKey = null; demoMode = false; wipeKeyring(); }
  if (demo !== undefined) demoMode = demo;
  persist();
  // Identity changed: everything cached belongs to the previous seat.
  queryClient.removeQueries({ type: "inactive" });
  queryClient.resetQueries();
}
export function isDemoMode() {
  return demoMode && !!sessionToken;
}
/** Absolute API URL — raw fetches (file downloads) must go through the deploy proxy too. */
export function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}
export function getSessionToken() {
  return sessionToken;
}
export function getRecoveryKey() {
  return recoveryKey;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let message = res.statusText;
    let body: { message?: string; code?: string; reason?: string } = {};
    try {
      body = await res.json();
      message = body.message || message;
    } catch {
      /* keep statusText */
    }
    // The status tells a refusal (the server said no) from a fault or a dropped
    // connection, the latter of which carries no status and should not sign anyone out.
    throw Object.assign(new Error(message), { status: res.status, code: body.code, reason: body.reason });
  }
}

function authHeaders(data?: unknown): Record<string, string> {
  const h: Record<string, string> = {};
  if (data) h["Content-Type"] = "application/json";
  if (sessionToken) {
    h["x-diavanish-session"] = sessionToken;
    h["x-aperture-session"] = sessionToken;
  }
  return h;
}

export type ApiError = Error & { status?: number; code?: string; reason?: string };
/** True when the server answered and refused: the session or the thing asked for is gone. */
export function isRefusal(e: unknown): boolean {
  const status = (e as ApiError | null)?.status;
  return status === 401 || status === 403 || status === 404;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: authHeaders(data),
    body: data ? JSON.stringify(data) : undefined,
  });
  await throwIfResNotOk(res);
  return res;
}

export async function apiJson<T>(method: string, url: string, data?: unknown): Promise<T> {
  const res = await apiRequest(method, url, data);
  return (await res.json()) as T;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, {
      headers: sessionToken ? { "x-diavanish-session": sessionToken, "x-aperture-session": sessionToken } : {},
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
