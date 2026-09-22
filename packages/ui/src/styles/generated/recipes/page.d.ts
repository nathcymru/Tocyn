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

type PageSlot = "root" | "header" | "content" | "grid" | "section" | "settingsSections" | "settingsField" | "settingsError" | "settingsHelp" | "knowledgeWorkspace" | "knowledgeSidebar" | "knowledgeContent" | "knowledgeTable" | "knowledgeRow" | "knowledgeSearch" | "knowledgePreview" | "knowledgeCategoryRow" | "knowledgeCategoryRowSelected" | "knowledgeCategoryMain" | "knowledgeCategoryActions" | "knowledgeCategoryChildren" | "knowledgeCategoryList" | "knowledgeCategorySpacer" | "knowledgeCategoryButton" | "knowledgeDeleteActions" | "accountGrid" | "accountIdentityName" | "accountIdentityEmail" | "inboxWorkspace" | "inboxList" | "inboxDetail" | "inboxHeader" | "inboxHiddenHeading" | "inboxMetrics" | "inboxToolbar" | "inboxRows" | "inboxRow" | "inboxTable" | "inboxTableWrap" | "inboxTableRow" | "inboxPresentationButton" | "inboxPresentationActive" | "inboxPresentationInactive" | "inboxEmpty" | "inboxMobileHidden" | "inboxTableMobileHidden" | "inboxStatus" | "inboxPriority" | "inboxMobileNote" | "inboxTableResponsive" | "inboxTitleRow" | "inboxRowCopy" | "inboxRowSubject" | "inboxRowCustomer" | "inboxRowDate" | "inboxRowPreview" | "inboxRowMeta" | "inboxToolbarGroup" | "inboxPagination" | "dashboardHeading" | "dashboardAction" | "metricStrip" | "metricCard" | "metricCardHeader" | "metricCardBody" | "metricIcon" | "metricLabel" | "metricValue" | "panels" | "panelHeader" | "panelIcon" | "panelTitle" | "priorityList" | "priorityRow" | "overviewGrid" | "overviewCard" | "overviewCardBody" | "overviewCardLabel" | "overviewCardValue" | "overviewFooter"

export type PageVariantProps = {
  [key in keyof PageVariant]?: PageVariant[key] | undefined
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