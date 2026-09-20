import primitiveStyles from '@luminatick/ui/styles.css?inline';
import atkinsonRegular from '@fontsource/atkinson-hyperlegible/400.css?inline';
import atkinsonBold from '@fontsource/atkinson-hyperlegible/700.css?inline';
import interRegular from '@fontsource/inter/400.css?inline';
import interMedium from '@fontsource/inter/500.css?inline';
import interSemibold from '@fontsource/inter/600.css?inline';
import { EnvironmentProvider } from '@luminatick/ui/ark';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { w } from './widgetStyles';
import { appendLegacyWidgetCss } from './compatibility-styles';

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
  // The IIFE is the widget's only required host asset. Keep font faces with
  // Park/Panda rules inside the ShadowRoot instead of emitting a host CSS file.
  primitiveStyleElement.textContent = [
    atkinsonRegular, atkinsonBold, interRegular, interMedium, interSemibold,
    primitiveStyles,
  ].join('\n');
  shadow.appendChild(primitiveStyleElement);
  // Keep the historical host opt-in inside this ShadowRoot and after the
  // generated sheet; without a primitive string, default rendering is unchanged.
  appendLegacyWidgetCss(shadow);
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <EnvironmentProvider value={() => shadow}>
        <App />
      </EnvironmentProvider>
    </React.StrictMode>
  );
})();
