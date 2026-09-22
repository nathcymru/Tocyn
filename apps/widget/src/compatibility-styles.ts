/** Legacy host opt-in. The default widget uses only its bundled Park/Panda sheet. */
export function appendLegacyWidgetCss(shadow: ShadowRoot, hostWindow: Window = window): void {
  const css = (hostWindow as Window & { LUMINA_WIDGET_CSS?: unknown }).LUMINA_WIDGET_CSS;
  if (typeof css !== 'string' || css.length === 0) return;

  const style = document.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);
}
