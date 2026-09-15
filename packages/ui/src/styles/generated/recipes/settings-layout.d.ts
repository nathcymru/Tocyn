/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface SettingsLayoutVariant {
  
}

type SettingsLayoutVariantMap = {
  [key in keyof SettingsLayoutVariant]: Array<SettingsLayoutVariant[key]>
}

type SettingsLayoutSlot = "root" | "sidebar" | "sidebarInner" | "title" | "nav" | "navLink" | "navIcon" | "sectionTitle" | "main" | "content"

export type SettingsLayoutVariantProps = {
  [key in keyof SettingsLayoutVariant]?: ConditionalValue<SettingsLayoutVariant[key]> | undefined
}

export interface SettingsLayoutRecipe {
  __slot: SettingsLayoutSlot
  __type: SettingsLayoutVariantProps
  (props?: SettingsLayoutVariantProps): Pretty<Record<SettingsLayoutSlot, string>>
  raw: (props?: SettingsLayoutVariantProps) => SettingsLayoutVariantProps
  variantMap: SettingsLayoutVariantMap
  variantKeys: Array<keyof SettingsLayoutVariant>
  splitVariantProps<Props extends SettingsLayoutVariantProps>(props: Props): [SettingsLayoutVariantProps, Pretty<DistributiveOmit<Props, keyof SettingsLayoutVariantProps>>]
  getVariantProps: (props?: SettingsLayoutVariantProps) => SettingsLayoutVariantProps
}


export declare const settingsLayout: SettingsLayoutRecipe