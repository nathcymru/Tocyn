let BASE_URL = '/api/v1/widget';
if (import.meta.env.VITE_API_URL) {
  const url = import.meta.env.VITE_API_URL.replace(/\/+$/, '');
  BASE_URL = url.includes('/api/v1/widget') ? url : `${url}/api/v1/widget`;
}
export { BASE_URL };

// The embed supplies a public widget key; it is never a tenant identifier.
export function widgetHeaders(): Headers {
  const key = document.querySelector<HTMLScriptElement>('script[data-widget-key]')?.dataset.widgetKey
    || import.meta.env.VITE_WIDGET_KEY;
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (key) headers.set('X-Widget-Key', key);
  return headers;
}
