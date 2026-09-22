/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface ComposerVariant {
  
}

type ComposerVariantMap = {
  [key in keyof ComposerVariant]: Array<ComposerVariant[key]>
}

type ComposerSlot = "root" | "formatHelp" | "markdown" | "toolbar" | "toolbarButton" | "input" | "editor" | "autocomplete" | "autocompleteOption" | "dropHelp" | "preview" | "previewSummary" | "previewBody"

export type ComposerVariantProps = {
  [key in keyof ComposerVariant]?: ConditionalValue<ComposerVariant[key]> | undefined
}

export interface ComposerRecipe {
  __slot: ComposerSlot
  __type: ComposerVariantProps
  (props?: ComposerVariantProps): Pretty<Record<ComposerSlot, string>>
  raw: (props?: ComposerVariantProps) => ComposerVariantProps
  variantMap: ComposerVariantMap
  variantKeys: Array<keyof ComposerVariant>
  splitVariantProps<Props extends ComposerVariantProps>(props: Props): [ComposerVariantProps, Pretty<DistributiveOmit<Props, keyof ComposerVariantProps>>]
  getVariantProps: (props?: ComposerVariantProps) => ComposerVariantProps
}


export declare const composer: ComposerRecipe