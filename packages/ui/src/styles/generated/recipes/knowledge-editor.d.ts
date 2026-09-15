/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface KnowledgeEditorVariant {
  
}

type KnowledgeEditorVariantMap = {
  [key in keyof KnowledgeEditorVariant]: Array<KnowledgeEditorVariant[key]>
}

type KnowledgeEditorSlot = "root" | "header" | "heading" | "back" | "title" | "save" | "spinner" | "content" | "stack" | "error" | "card" | "fields" | "field" | "control" | "tiptap"

export type KnowledgeEditorVariantProps = {
  [key in keyof KnowledgeEditorVariant]?: ConditionalValue<KnowledgeEditorVariant[key]> | undefined
}

export interface KnowledgeEditorRecipe {
  __slot: KnowledgeEditorSlot
  __type: KnowledgeEditorVariantProps
  (props?: KnowledgeEditorVariantProps): Pretty<Record<KnowledgeEditorSlot, string>>
  raw: (props?: KnowledgeEditorVariantProps) => KnowledgeEditorVariantProps
  variantMap: KnowledgeEditorVariantMap
  variantKeys: Array<keyof KnowledgeEditorVariant>
  splitVariantProps<Props extends KnowledgeEditorVariantProps>(props: Props): [KnowledgeEditorVariantProps, Pretty<DistributiveOmit<Props, keyof KnowledgeEditorVariantProps>>]
  getVariantProps: (props?: KnowledgeEditorVariantProps) => KnowledgeEditorVariantProps
}


export declare const knowledgeEditor: KnowledgeEditorRecipe