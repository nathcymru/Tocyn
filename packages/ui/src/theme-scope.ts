import { resolveTocynTheme, type TocynThemeInput, type ResolvedTocynTheme } from './theme';

const MANAGED_ATTRIBUTE = 'data-tocyn-theme-mode';
const ownedElements = new WeakSet<HTMLElement>();

export interface TocynThemeScope {
  readonly theme: ResolvedTocynTheme;
  apply(input: TocynThemeInput): ResolvedTocynTheme;
  remove(): void;
}

/** Applies validated variables to one container and restores its prior inline state on removal. */
export function createTocynThemeScope(element: HTMLElement, input: TocynThemeInput = {}): TocynThemeScope {
  const ElementType = element?.ownerDocument?.defaultView?.HTMLElement;
  if (!ElementType || !(element instanceof ElementType)) throw new TypeError('A theme scope requires an HTMLElement');
  if (ownedElements.has(element)) throw new TypeError('This element already has a theme scope');
  const names = Object.keys(resolveTocynTheme().variables);
  const original = new Map(names.map(name => [name, { value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name) }]));
  const originalMode = element.hasAttribute(MANAGED_ATTRIBUTE) ? element.getAttribute(MANAGED_ATTRIBUTE) : null;
  const hadMode = element.hasAttribute(MANAGED_ATTRIBUTE);
  let current = resolveTocynTheme(input);
  let active = false;
  let disposed = false;

  const apply = (nextInput: TocynThemeInput): ResolvedTocynTheme => {
    if (disposed) throw new TypeError('This theme scope has been removed');
    // Resolve before touching the DOM, keeping invalid updates atomic.
    const next = resolveTocynTheme(nextInput);
    for (const [name, value] of Object.entries(next.variables)) element.style.setProperty(name, value);
    element.setAttribute(MANAGED_ATTRIBUTE, next.mode);
    current = next;
    active = true;
    return next;
  };
  apply(input);
  ownedElements.add(element);

  return {
    get theme() { return current; },
    apply,
    remove() {
      if (!active) return;
      for (const name of names) {
        const prior = original.get(name)!;
        if (prior.value) element.style.setProperty(name, prior.value, prior.priority);
        else element.style.removeProperty(name);
      }
      if (hadMode) element.setAttribute(MANAGED_ATTRIBUTE, originalMode!);
      else element.removeAttribute(MANAGED_ATTRIBUTE);
      active = false;
      disposed = true;
      ownedElements.delete(element);
    },
  };
}
