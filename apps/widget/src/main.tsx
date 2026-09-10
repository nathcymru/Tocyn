import primitiveStyles from '@luminatick/ui/styles.css?inline';
import { EnvironmentProvider } from '@luminatick/ui/ark';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import widgetStyles from './index.css?inline';

// The widget is intended to be self-initializing when the script is included.
(function () {
  const CONTAINER_ID = 'lumina-widget-container';

  if (document.getElementById(CONTAINER_ID)) {
    return;
  }

  const container = document.createElement('div');
  container.id = CONTAINER_ID;
  document.body.appendChild(container);

  const shadow = container.attachShadow({ mode: 'open' });
  const root = document.createElement('div');
  root.id = 'lumina-widget-root';
  shadow.appendChild(root);
  const primitiveStyleElement = document.createElement('style');
  primitiveStyleElement.textContent = primitiveStyles;
  shadow.appendChild(primitiveStyleElement);
  const widgetStyleElement = document.createElement('style');
  // Vite compiles this import; widget utility styles stay inside the shadow tree.
  widgetStyleElement.textContent = widgetStyles;
  shadow.appendChild(widgetStyleElement);

  const styles = document.createElement('style');
  // Widget positioning remains scoped to this shadow tree.
  styles.textContent = `
    #lumina-widget-root {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999999;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
    }
  `;
  shadow.appendChild(styles);

  // Retain optional legacy shadow-scoped additions for existing embedders.
  if ((window as any).LUMINA_WIDGET_CSS) {
    const tailwindStyles = document.createElement('style');
    tailwindStyles.textContent = (window as any).LUMINA_WIDGET_CSS;
    shadow.appendChild(tailwindStyles);
  }

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <EnvironmentProvider value={() => shadow}>
        <App />
      </EnvironmentProvider>
    </React.StrictMode>
  );
})();
