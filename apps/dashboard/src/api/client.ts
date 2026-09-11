import { useAuthStore } from '../store/authStore';

let BASE_URL = '/api';
if (import.meta.env.VITE_API_URL) {
  const url = import.meta.env.VITE_API_URL.replace(/\/+$/, '');
  BASE_URL = url.endsWith('/api') ? url : `${url}/api`;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

const pending = new Set<AbortController>();
useAuthStore.subscribe((current, previous) => {
  if (current.sessionGeneration !== previous.sessionGeneration || current.token !== previous.token) {
    for (const controller of pending) controller.abort();
    pending.clear();
  }
});

function obsoleteRequest(): Error {
  return new DOMException('Request cancelled after authentication changed', 'AbortError');
}

/** Fence both response data and auth/download side effects to the initiating session. */
async function sessionRequest<T>(path: string, options: RequestInit, read: (response: Response) => Promise<T>): Promise<T> {
  const { token, user, sessionGeneration } = useAuthStore.getState();
  // Bad credentials belong to the signed-out form. Protected requests and MFA
  // challenges still invalidate the current session when authentication fails.
  const isSignedOutLogin = path === '/auth/login' && options.method === 'POST' && token === null && user === null;
  const assertCurrent = () => {
    const current = useAuthStore.getState();
    if (current.token !== token || current.sessionGeneration !== sessionGeneration) throw obsoleteRequest();
  };
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', abort, {once:true});
  pending.add(controller);
  try {
    const headers = new Headers(options.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${BASE_URL}${path}`, {...options,headers,signal:controller.signal});
    assertCurrent();
    if (response.status === 401 && !isSignedOutLogin) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
      throw new ApiError('Unauthorized',401);
    }
    if (!response.ok) {
      let message = `Request failed with status ${response.status}`;
      let code: string | undefined;
      try {
        const error = await response.json();
        message = error.error || error.message || message;
        code = typeof error.code === 'string' ? error.code : undefined;
      } catch {
        if (response.status === 404) message = 'Resource not found (404)';
      }
      assertCurrent();
      throw new ApiError(message,response.status,code);
    }
    const value = await read(response);
    assertCurrent();
    return value;
  } finally {
    pending.delete(controller);
    options.signal?.removeEventListener('abort',abort);
  }
}

export function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return sessionRequest(path, options, response => response.json() as Promise<T>);
}

export function requestWithHeaders<T>(path: string, options: RequestInit = {}): Promise<{ data: T; headers: Headers }> {
  return sessionRequest(path, options, async response => ({ data: await response.json() as T, headers: response.headers }));
}

/** A 204 is an authorized absence, distinct from a JSON parse failure. */
export function requestOptional<T>(path: string, options: RequestInit = {}): Promise<T | null> {
  return sessionRequest(path, options, response => response.status === 204 ? Promise.resolve(null) : response.json() as Promise<T>);
}

/** Mutations that intentionally return no body still retain normal auth-session fencing. */
export function requestEmpty(path: string, options: RequestInit = {}): Promise<void> {
  return sessionRequest(path, options, async () => undefined);
}

export type BoundedBlob = Readonly<{ blob: Blob; contentType: string }>;

function mediaType(value: string | null): string {
  return value?.split(';', 1)[0]?.trim().toLowerCase() || '';
}

/** Read an authenticated binary response without retaining more than the caller's declared limit. */
export function requestBoundedBlob(path: string, options: RequestInit, maximumBytes: number, allowedContentTypes: readonly string[]): Promise<BoundedBlob> {
  return sessionRequest(path, options, async response => {
    const contentType = mediaType(response.headers.get('Content-Type'));
    if (!allowedContentTypes.includes(contentType)) {
      await response.body?.cancel();
      throw new ApiError('Attachment type cannot be previewed.', 415);
    }

    const contentLength = response.headers.get('Content-Length');
    if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maximumBytes) {
      await response.body?.cancel();
      throw new ApiError('Attachment is too large to preview.', 413);
    }

    const reader = response.body?.getReader();
    if (!reader) return { blob: new Blob([], { type: contentType }), contentType };

    const chunks: ArrayBuffer[] = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maximumBytes) {
          await reader.cancel();
          throw new ApiError('Attachment is too large to preview.', 413);
        }
        const copy = new Uint8Array(value.byteLength);
        copy.set(value);
        chunks.push(copy.buffer);
      }
    } finally {
      reader.releaseLock();
    }
    return { blob: new Blob(chunks, { type: contentType }), contentType };
  });
}

export const dashboardApi = {
  get: <T>(path: string, options?: RequestInit) => request<T>(path, {...options,method:'GET'}),
  getWithHeaders: <T>(path: string, options?: RequestInit) => requestWithHeaders<T>(path, {...options,method:'GET'}),
  getOptional: <T>(path: string, options?: RequestInit) => requestOptional<T>(path, {...options,method:'GET'}),
  post: <T>(path: string, body?: unknown, options?: RequestInit) => request<T>(path,{...options,method:'POST',body:JSON.stringify(body)}),
  postForm: <T>(path: string, body: FormData, options?: RequestInit) => request<T>(path,{...options,method:'POST',body}),
  patch: <T>(path: string, body?: unknown, options?: RequestInit) => request<T>(path,{...options,method:'PATCH',body:JSON.stringify(body)}),
  put: <T>(path: string, body?: unknown, options?: RequestInit) => request<T>(path,{...options,method:'PUT',body:JSON.stringify(body)}),
  delete: <T>(path: string, options?: RequestInit) => request<T>(path,{...options,method:'DELETE'}),
  deleteEmpty: (path: string, options?: RequestInit) => requestEmpty(path,{...options,method:'DELETE'}),
  boundedBlob: (path: string, maximumBytes: number, allowedContentTypes: readonly string[], options?: RequestInit) =>
    requestBoundedBlob(path, {...options, method:'GET'}, maximumBytes, allowedContentTypes),
  download: async (path: string, filename: string) => {
    // The body is fenced too: a late old-session attachment must not be downloaded.
    const session = useAuthStore.getState();
    const blob = await sessionRequest(path,{method:'GET'},response => response.blob());
    const current = useAuthStore.getState();
    if (current.token !== session.token || current.sessionGeneration !== session.sessionGeneration) throw obsoleteRequest();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    window.URL.revokeObjectURL(url);
    link.remove();
  },
};
