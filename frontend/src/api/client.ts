import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

const BASE = (import.meta as any).env?.VITE_API_BASE || '/api/v1';

let accessToken: string | null = null;
let stepUpToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(t: string | null) {
  accessToken = t;
}
export function setStepUpToken(t: string | null) {
  stepUpToken = t;
}
export function registerUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export const http: AxiosInstance = axios.create({
  baseURL: BASE,
  withCredentials: true, // send the HttpOnly refresh cookie
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) config.headers.set('Authorization', `Bearer ${accessToken}`);
  if (stepUpToken) config.headers.set('X-StepUp-Token', stepUpToken);
  return config;
});

let refreshing: Promise<string | null> | null = null;

async function refreshAccess(): Promise<string | null> {
  try {
    const { data } = await axios.post(`${BASE}/auth/refresh`, {}, { withCredentials: true });
    accessToken = data.accessToken;
    return accessToken;
  } catch {
    return null;
  }
}

http.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    const status = error.response?.status;
    const url = original?.url || '';

    // Attempt a single silent refresh on 401 (except for the auth endpoints).
    if (status === 401 && !original._retry && !url.includes('/auth/login') && !url.includes('/auth/refresh')) {
      original._retry = true;
      refreshing = refreshing || refreshAccess();
      const token = await refreshing;
      refreshing = null;
      if (token) {
        original.headers.set('Authorization', `Bearer ${token}`);
        return http(original);
      }
      onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);

/** Normalise an API error into a readable message. */
export function apiError(e: unknown): string {
  const err = e as AxiosError<any>;
  const m = err.response?.data?.message;
  if (Array.isArray(m)) return m.join('، ');
  return m || err.message || 'خطای ناشناخته';
}
