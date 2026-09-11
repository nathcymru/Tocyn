import { PRODUCT_BRAND } from '@luminatick/shared/product-brand';

/** Central rendering adapter: application identity never substitutes for a user avatar. */
export function ProductLogo({ compact = false, className = '', decorative = false, mode }: {
  compact?: boolean; className?: string; decorative?: boolean; mode?: 'light' | 'dark';
}) {
  const alt = decorative ? '' : PRODUCT_BRAND.name;
  if (compact) return <img className={className} src={PRODUCT_BRAND.icon} alt={alt} />;
  if (mode) return <img className={className} src={PRODUCT_BRAND.lockup[mode]} alt={alt} />;
  return <span className={`tocyn-product-lockup ${className}`}>
    <img className="tocyn-product-lockup-light" src={PRODUCT_BRAND.lockup.light} alt={alt} />
    <img className="tocyn-product-lockup-dark" src={PRODUCT_BRAND.lockup.dark} alt={alt} />
  </span>;
}
