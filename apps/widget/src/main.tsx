import primitiveStyles from '@luminatick/ui/styles.css?inline';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
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
      font-family: var(--tocyn-font-primary, 'Atkinson Hyperlegible', ui-sans-serif, system-ui, sans-serif);
    }
  `;
  shadow.appendChild(styles);

  // Retain optional legacy shadow-scoped additions for existing embedders.
  if ((window as any).LUMINA_WIDGET_CSS) {
    const legacyWidgetStyles = document.createElement('style');
    legacyWidgetStyles.textContent = (window as any).LUMINA_WIDGET_CSS;
    shadow.appendChild(legacyWidgetStyles);
  }

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <EnvironmentProvider value={() => shadow}>
        <App />
      </EnvironmentProvider>
    </React.StrictMode>
  );
})();
