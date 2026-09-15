/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface GlobalSearchVariant {
  
}

type GlobalSearchVariantMap = {
  [key in keyof GlobalSearchVariant]: Array<GlobalSearchVariant[key]>
}

type GlobalSearchSlot = "root" | "inputShell" | "icon" | "input" | "shortcut" | "divider" | "scope" | "clear" | "popover" | "status" | "results" | "result" | "preview"

export type GlobalSearchVariantProps = {
  [key in keyof GlobalSearchVariant]?: ConditionalValue<GlobalSearchVariant[key]> | undefined
}

export interface GlobalSearchRecipe {
  __slot: GlobalSearchSlot
  __type: GlobalSearchVariantProps
  (props?: GlobalSearchVariantProps): Pretty<Record<GlobalSearchSlot, string>>
  raw: (props?: GlobalSearchVariantProps) => GlobalSearchVariantProps
  variantMap: GlobalSearchVariantMap
  variantKeys: Array<keyof GlobalSearchVariant>
  splitVariantProps<Props extends GlobalSearchVariantProps>(props: Props): [GlobalSearchVariantProps, Pretty<DistributiveOmit<Props, keyof GlobalSearchVariantProps>>]
  getVariantProps: (props?: GlobalSearchVariantProps) => GlobalSearchVariantProps
}


export declare const globalSearch: GlobalSearchRecipe