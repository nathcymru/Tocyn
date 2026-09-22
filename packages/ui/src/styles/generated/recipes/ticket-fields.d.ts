/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface TicketFieldsVariant {
  
}

type TicketFieldsVariantMap = {
  [key in keyof TicketFieldsVariant]: Array<TicketFieldsVariant[key]>
}

type TicketFieldsSlot = "page" | "header" | "title" | "description" | "create" | "createIcon" | "tableShell" | "table" | "tableHead" | "tableRow" | "fieldType" | "fieldStatus" | "fieldStatusActive" | "fieldStatusInactive" | "dialog" | "dialogHeader" | "dialogTitle" | "dialogClose" | "dialogCloseIcon" | "dialogForm" | "dialogError" | "dialogFields" | "dialogLabel" | "dialogControl" | "dialogHelp" | "optionsReveal" | "checkbox" | "dialogActions" | "dialogCancel" | "dialogSubmit"

export type TicketFieldsVariantProps = {
  [key in keyof TicketFieldsVariant]?: ConditionalValue<TicketFieldsVariant[key]> | undefined
}

export interface TicketFieldsRecipe {
  __slot: TicketFieldsSlot
  __type: TicketFieldsVariantProps
  (props?: TicketFieldsVariantProps): Pretty<Record<TicketFieldsSlot, string>>
  raw: (props?: TicketFieldsVariantProps) => TicketFieldsVariantProps
  variantMap: TicketFieldsVariantMap
  variantKeys: Array<keyof TicketFieldsVariant>
  splitVariantProps<Props extends TicketFieldsVariantProps>(props: Props): [TicketFieldsVariantProps, Pretty<DistributiveOmit<Props, keyof TicketFieldsVariantProps>>]
  getVariantProps: (props?: TicketFieldsVariantProps) => TicketFieldsVariantProps
}


export declare const ticketFields: TicketFieldsRecipe