import { useAuthStore } from '../store/authStore';

let BASE_URL = '/api/v1/customer';
if (import.meta.env.VITE_API_URL) {
  const url = import.meta.env.VITE_API_URL.replace(/\/+$/, '');
  BASE_URL = url.includes('/api/v1/customer') ? url : `${url}/api/v1/customer`;
}

// Keep the public routing key across navigation even when browser storage is blocked.
let navigationWidgetKey = '';
export function getWidgetKey(): string {
  const incoming = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('key')?.trim();
  if (incoming) {
    navigationWidgetKey = incoming;
    try { sessionStorage.setItem('tocyn_widget_key', incoming); } catch { /* Storage is optional. */ }
    return incoming;
  }
  if (navigationWidgetKey) return navigationWidgetKey;
  try {
    const saved = sessionStorage.getItem('tocyn_widget_key');
    if (saved) return (navigationWidgetKey = saved);
  } catch { /* Fall back to explicit deployment configuration. */ }
  return import.meta.env.VITE_WIDGET_KEY || '';
}

function getCustomerToken(): string | null {
  try { return localStorage.getItem('lumina_customer_token'); }
  catch { return null; } // Cookie authentication remains available.
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const requestAuthGeneration = useAuthStore.getState().authGeneration;
  const headers = new Headers(options.headers || {});
  const widgetKey = getWidgetKey();
  if (widgetKey) headers.set('X-Widget-Key', widgetKey);
  
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getCustomerToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include', // Important for customer portal cookies!
  });

  if (response.status === 401) {
    if (useAuthStore.getState().authGeneration === requestAuthGeneration) {
      useAuthStore.getState().logout();
      if (window.location.pathname !== '/login' && window.location.pathname !== '/verify') {
        window.location.href = '/login';
      }
    }
    throw new ApiError('Unauthorized', 401);
  }

  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`;
    try {
      const error = await response.json();
      errorMessage = error.error || error.message || errorMessage;
    } catch {
      if (response.status === 404) {
        errorMessage = 'Resource not found (404)';
      }
    }
    throw new ApiError(errorMessage, response.status);
  }

  return response.json();
}

export const portalApi = {
  get: <T>(path: string, options?: RequestInit) => request<T>(path, { ...options, method: 'GET' }),
  getTicketSla: <T>(ticketId: string) => request<T>(`/tickets/${encodeURIComponent(ticketId)}/sla`, { method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestInit) => 
    request<T>(path, { ...options, method: 'POST', body: JSON.stringify(body) }),
  postForm: <T>(path: string, body: FormData, options?: RequestInit) => {
    // For FormData, we let the browser set the Content-Type header with boundaries
    const { headers, ...restOptions } = options || {};
    return request<T>(path, { ...restOptions, method: 'POST', body, headers });
  },
  patch: <T>(path: string, body?: unknown, options?: RequestInit) => 
    request<T>(path, { ...options, method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown, options?: RequestInit) => 
    request<T>(path, { ...options, method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string, options?: RequestInit) => request<T>(path, { ...options, method: 'DELETE' }),
  download: async (path: string, filename: string) => {
    const generation = useAuthStore.getState().authGeneration;
    const assertCurrentSession = () => {
      if (useAuthStore.getState().authGeneration !== generation) {
        throw new DOMException('Download cancelled after authentication changed', 'AbortError');
      }
    };
    const headers = new Headers();
    const widgetKey = getWidgetKey();
    if (widgetKey) headers.set('X-Widget-Key', widgetKey);
    const token = getCustomerToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(`${BASE_URL}${path}`, { headers, credentials: 'include' });
    assertCurrentSession();
    if (res.status === 401) {
      useAuthStore.getState().logout();
      if (window.location.pathname !== '/login' && window.location.pathname !== '/verify') {
        window.location.href = '/login';
      }
      throw new ApiError('Unauthorized', 401);
    }
    if (!res.ok) throw new ApiError('Failed to download', res.status);
    const blob = await res.blob();
    assertCurrentSession();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    try {
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
    } finally {
      window.URL.revokeObjectURL(url);
      a.remove();
    }
  },

};
