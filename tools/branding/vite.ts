import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { AUTH_SPLASH } from '../../packages/shared/auth-splash';
import { PRODUCT_BRAND } from '../../packages/shared/product-brand';

/** Serve/emit the canonical public assets without copying unrelated repository assets. */
export function productBranding(surface: string): Plugin {
  const paths: readonly string[] = [PRODUCT_BRAND.icon, ...Object.values(PRODUCT_BRAND.lockup), ...AUTH_SPLASH.light, ...AUTH_SPLASH.dark];
  const asset = (path: string) => readFileSync(resolve(import.meta.dirname, '../../public', path.slice(1)));
  return {
    name: 'product-branding',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0];
        if (!path || !paths.includes(path)) return next();
        response.setHeader('Content-Type', path.endsWith('.webp') ? 'image/webp' : 'image/png');
        response.end(asset(path));
      });
    },
    generateBundle() {
      for (const path of paths) this.emitFile({ type: 'asset', fileName: path.slice(1), source: asset(path) });
    },
    transformIndexHtml(html) {
      return { html: html.replace(/<title>.*?<\/title>/, `<title>${PRODUCT_BRAND.name} ${surface}</title>`),
        tags: [{ tag: 'link', attrs: { rel: 'icon', type: 'image/png', href: PRODUCT_BRAND.icon }, injectTo: 'head' }] };
    },
  };
}
