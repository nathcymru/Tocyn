/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface AbsoluteCenterVariant {
  /**
 * @default "both"
 */
axis: "horizontal" | "vertical" | "both"
}

type AbsoluteCenterVariantMap = {
  [key in keyof AbsoluteCenterVariant]: Array<AbsoluteCenterVariant[key]>
}



export type AbsoluteCenterVariantProps = {
  [key in keyof AbsoluteCenterVariant]?: ConditionalValue<AbsoluteCenterVariant[key]> | undefined
}

export interface AbsoluteCenterRecipe {
  
  __type: AbsoluteCenterVariantProps
  (props?: AbsoluteCenterVariantProps): string
  raw: (props?: AbsoluteCenterVariantProps) => AbsoluteCenterVariantProps
  variantMap: AbsoluteCenterVariantMap
  variantKeys: Array<keyof AbsoluteCenterVariant>
  splitVariantProps<Props extends AbsoluteCenterVariantProps>(props: Props): [AbsoluteCenterVariantProps, Pretty<DistributiveOmit<Props, keyof AbsoluteCenterVariantProps>>]
  getVariantProps: (props?: AbsoluteCenterVariantProps) => AbsoluteCenterVariantProps
}


export declare const absoluteCenter: AbsoluteCenterRecipe