let BASE_URL = '/api/v1/widget';
if (import.meta.env.VITE_API_URL) {
  const url = import.meta.env.VITE_API_URL.replace(/\/+$/, '');
  BASE_URL = url.includes('/api/v1/widget') ? url : `${url}/api/v1/widget`;
}
export { BASE_URL };

// Widget keys select public configuration; only a customer JWT authenticates a session.
export function widgetHeaders(): Headers {
  const script = typeof document === 'undefined' ? null
    : document.querySelector<HTMLScriptElement>('script[data-widget-key]');
  const key = script?.dataset.widgetKey || import.meta.env.VITE_WIDGET_KEY;
  let token = script?.dataset.widgetToken;
  if (!token && typeof localStorage !== 'undefined') {
    try { token = localStorage.getItem('lumina_customer_token') || undefined; } catch { /* Storage may be disabled. */ }
  }
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (key) headers.set('X-Widget-Key', key);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

export async function getWidgetSession(): Promise<{ email: string } | null> {
  const response = await fetch(`${BASE_URL.replace(/\/widget$/, '/customer')}/auth/me`, {
    headers: widgetHeaders(), credentials: 'include'
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data.user && typeof data.user.email === 'string' ? data.user : null;
}
