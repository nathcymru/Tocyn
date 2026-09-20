/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface ShellVariant {
  
}

type ShellVariantMap = {
  [key in keyof ShellVariant]: Array<ShellVariant[key]>
}

type ShellSlot = "root" | "body" | "sidebar" | "sidebarFooter" | "settingsNavigation" | "sidebarPersonaHost" | "headerPersonaHost" | "headerSearch" | "main" | "header" | "pageTitle" | "content" | "navigation" | "navigationLink" | "navigationLinkLabelled" | "navigationLinkIcon" | "navigationIcon" | "sidebarDesktop" | "sidebarLabelled" | "sidebarCompact" | "logoLink" | "logo" | "mobileDialog" | "mobileDialogLabelled" | "mobileDialogCompact" | "mobileContent" | "mobileClose" | "mobileTrigger" | "personaTrigger" | "personaTriggerLabelled" | "personaAvatar" | "personaStatus" | "personaDetails" | "personaName" | "personaPresence" | "accountMenu" | "accountSummary" | "accountSummaryName" | "accountSummaryEmail" | "menuItem" | "activityTrigger" | "activityPopover" | "activityBadge" | "activityHeader" | "activityTitle" | "activityRefresh" | "activityDismiss" | "activityLoading" | "activityEmpty" | "activityScroll" | "activityList" | "activityRow" | "activityItem" | "activitySubject" | "activityMoreWrap" | "activityMore" | "connectionWrap" | "connectionPopover" | "connectionButton" | "connectionLabel" | "connectionDot" | "connectionChevron" | "reconnectDivider" | "reconnectButton" | "icon" | "menuIcon" | "smallIcon" | "dismissIcon" | "rootInbox" | "rootStandard" | "contentInbox" | "contentStandard" | "contentPadded"

export type ShellVariantProps = {
  [key in keyof ShellVariant]?: ConditionalValue<ShellVariant[key]> | undefined
}

export interface ShellRecipe {
  __slot: ShellSlot
  __type: ShellVariantProps
  (props?: ShellVariantProps): Pretty<Record<ShellSlot, string>>
  raw: (props?: ShellVariantProps) => ShellVariantProps
  variantMap: ShellVariantMap
  variantKeys: Array<keyof ShellVariant>
  splitVariantProps<Props extends ShellVariantProps>(props: Props): [ShellVariantProps, Pretty<DistributiveOmit<Props, keyof ShellVariantProps>>]
  getVariantProps: (props?: ShellVariantProps) => ShellVariantProps
}


export declare const shell: ShellRecipe