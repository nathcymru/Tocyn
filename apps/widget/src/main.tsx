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
import { w } from './widgetStyles';

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
  root.className = w.host;
  // The generated light palette selector must match inside the ShadowRoot.
  root.classList.add('light');
  shadow.appendChild(root);
  const primitiveStyleElement = document.createElement('style');
  primitiveStyleElement.textContent = primitiveStyles;
  shadow.appendChild(primitiveStyleElement);
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <EnvironmentProvider value={() => shadow}>
        <App />
      </EnvironmentProvider>
    </React.StrictMode>
  );
})();
