import { PRODUCT_BRAND } from '@luminatick/shared/product-brand';

type ProductLogoProps = { className?: string; decorative?: boolean } & (
  | { compact: true; mode?: never }
  | { compact?: false; mode: 'light' | 'dark' }
);

/** Central rendering adapter: application identity never substitutes for a user avatar. */
export function ProductLogo(props: ProductLogoProps) {
  const alt = props.decorative ? '' : PRODUCT_BRAND.name;
  if (props.compact) return <img className={props.className} src={PRODUCT_BRAND.icon} alt={alt} />;
  return <img className={props.className} src={PRODUCT_BRAND.lockup[props.mode]} alt={alt} />;
}
