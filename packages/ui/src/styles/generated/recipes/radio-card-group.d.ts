/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface RadioCardGroupVariant {
  /**
 * @default "outline"
 */
variant: "subtle" | "outline" | "surface" | "solid"
/**
 * @default "md"
 */
size: "md"
}

type RadioCardGroupVariantMap = {
  [key in keyof RadioCardGroupVariant]: Array<RadioCardGroupVariant[key]>
}

type RadioCardGroupSlot = "root" | "label" | "item" | "itemText" | "itemControl" | "indicator"

export type RadioCardGroupVariantProps = {
  [key in keyof RadioCardGroupVariant]?: ConditionalValue<RadioCardGroupVariant[key]> | undefined
}

export interface RadioCardGroupRecipe {
  __slot: RadioCardGroupSlot
  __type: RadioCardGroupVariantProps
  (props?: RadioCardGroupVariantProps): Pretty<Record<RadioCardGroupSlot, string>>
  raw: (props?: RadioCardGroupVariantProps) => RadioCardGroupVariantProps
  variantMap: RadioCardGroupVariantMap
  variantKeys: Array<keyof RadioCardGroupVariant>
  splitVariantProps<Props extends RadioCardGroupVariantProps>(props: Props): [RadioCardGroupVariantProps, Pretty<DistributiveOmit<Props, keyof RadioCardGroupVariantProps>>]
  getVariantProps: (props?: RadioCardGroupVariantProps) => RadioCardGroupVariantProps
}


export declare const radioCardGroup: RadioCardGroupRecipe