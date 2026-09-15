/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface TicketDetailVariant {
  
}

type TicketDetailVariantMap = {
  [key in keyof TicketDetailVariant]: Array<TicketDetailVariant[key]>
}

type TicketDetailSlot = "root" | "main" | "loading" | "unavailable" | "alert" | "notice" | "status" | "toolbar" | "back" | "controls" | "control" | "card" | "header" | "heading" | "titleStack" | "titleRow" | "reference" | "title" | "meta" | "customer" | "opened" | "presence" | "viewers" | "avatars" | "avatar" | "liveLabel" | "liveDot" | "typing" | "messages" | "timelineRow" | "timelineAvatar" | "timelineBubble" | "timelineMeta" | "timelineLabel" | "timelineTime" | "timelineBody" | "emailPresentation" | "emailSummary" | "emailSummaryIcon" | "emailSummaryLabel" | "emailSummaryTime" | "emailSummaryFields" | "emailDisclosure" | "emailCopy" | "attachments" | "attachmentLink" | "attachmentIcon" | "attachmentName" | "attachmentSize" | "legacyMarker" | "qa" | "qaActions" | "qaButton" | "qaButtonActive" | "qaButtonInactive" | "qaMarked" | "qaMarkedIcon" | "pagination" | "paginationButton" | "composerPanel" | "composerAlert" | "draftStatus" | "draftActions" | "composerForm" | "modeRow" | "modeGroup" | "modeButton" | "modeButtonActive" | "modeButtonInactive" | "suggestion" | "suggestionHeader" | "suggestionActions" | "suggestionCopy" | "replyCapability" | "mentions" | "mentionList" | "mentionOption" | "composerAttachments" | "composerAttachment" | "composerFooter" | "composerNote" | "composerActions" | "contextPanel" | "contextCard" | "contextSummary" | "contextBody" | "contextSettingsCard" | "contextSettingsFields" | "contextField" | "contextFieldLabel" | "contextFieldControl" | "contextHistory" | "contextHistoryItem" | "supportStateForm" | "supportStateHeader" | "supportStateFields" | "supportStateActions" | "supportStateHelp" | "supportStateNotice"

export type TicketDetailVariantProps = {
  [key in keyof TicketDetailVariant]?: ConditionalValue<TicketDetailVariant[key]> | undefined
}

export interface TicketDetailRecipe {
  __slot: TicketDetailSlot
  __type: TicketDetailVariantProps
  (props?: TicketDetailVariantProps): Pretty<Record<TicketDetailSlot, string>>
  raw: (props?: TicketDetailVariantProps) => TicketDetailVariantProps
  variantMap: TicketDetailVariantMap
  variantKeys: Array<keyof TicketDetailVariant>
  splitVariantProps<Props extends TicketDetailVariantProps>(props: Props): [TicketDetailVariantProps, Pretty<DistributiveOmit<Props, keyof TicketDetailVariantProps>>]
  getVariantProps: (props?: TicketDetailVariantProps) => TicketDetailVariantProps
}


export declare const ticketDetail: TicketDetailRecipe