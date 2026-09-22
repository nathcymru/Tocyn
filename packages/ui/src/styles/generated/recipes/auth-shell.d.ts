/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface AuthShellVariant {

}

type AuthShellVariantMap = {
  [key in keyof AuthShellVariant]: Array<AuthShellVariant[key]>
}

type AuthShellSlot = "root" | "splash" | "image" | "main" | "form" | "logo"

export type AuthShellVariantProps = {
  [key in keyof AuthShellVariant]?: ConditionalValue<AuthShellVariant[key]> | undefined
}

export interface AuthShellRecipe {
  __slot: AuthShellSlot
  __type: AuthShellVariantProps
  (props?: AuthShellVariantProps): Pretty<Record<AuthShellSlot, string>>
  raw: (props?: AuthShellVariantProps) => AuthShellVariantProps
  variantMap: AuthShellVariantMap
  variantKeys: Array<keyof AuthShellVariant>
  splitVariantProps<Props extends AuthShellVariantProps>(props: Props): [AuthShellVariantProps, Pretty<DistributiveOmit<Props, keyof AuthShellVariantProps>>]
  getVariantProps: (props?: AuthShellVariantProps) => AuthShellVariantProps
}


export declare const authShell: AuthShellRecipe
