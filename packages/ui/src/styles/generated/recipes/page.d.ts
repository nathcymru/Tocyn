/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface PageVariant {
  /**
 * @default "dashboard"
 */
kind: "dashboard" | "knowledge" | "inbox" | "settings" | "account"
}

type PageVariantMap = {
  [key in keyof PageVariant]: Array<PageVariant[key]>
}

type PageSlot = "root" | "header" | "content" | "grid" | "section"

export type PageVariantProps = {
  [key in keyof PageVariant]?: ConditionalValue<PageVariant[key]> | undefined
}

export interface PageRecipe {
  __slot: PageSlot
  __type: PageVariantProps
  (props?: PageVariantProps): Pretty<Record<PageSlot, string>>
  raw: (props?: PageVariantProps) => PageVariantProps
  variantMap: PageVariantMap
  variantKeys: Array<keyof PageVariant>
  splitVariantProps<Props extends PageVariantProps>(props: Props): [PageVariantProps, Pretty<DistributiveOmit<Props, keyof PageVariantProps>>]
  getVariantProps: (props?: PageVariantProps) => PageVariantProps
}


export declare const page: PageRecipe