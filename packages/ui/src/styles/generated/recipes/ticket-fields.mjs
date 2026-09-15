import { compact, getSlotCompoundVariant, memo, splitProps } from '../helpers.mjs';
import { createRecipe } from './create-recipe.mjs';

const ticketFieldsDefaultVariants = {}
const ticketFieldsCompoundVariants = []

const ticketFieldsSlotNames = [
  [
    "page",
    "ticketFields__page"
  ],
  [
    "header",
    "ticketFields__header"
  ],
  [
    "title",
    "ticketFields__title"
  ],
  [
    "description",
    "ticketFields__description"
  ],
  [
    "create",
    "ticketFields__create"
  ],
  [
    "createIcon",
    "ticketFields__createIcon"
  ],
  [
    "tableShell",
    "ticketFields__tableShell"
  ],
  [
    "table",
    "ticketFields__table"
  ],
  [
    "tableHead",
    "ticketFields__tableHead"
  ],
  [
    "tableRow",
    "ticketFields__tableRow"
  ],
  [
    "fieldType",
    "ticketFields__fieldType"
  ],
  [
    "fieldStatus",
    "ticketFields__fieldStatus"
  ],
  [
    "fieldStatusActive",
    "ticketFields__fieldStatusActive"
  ],
  [
    "fieldStatusInactive",
    "ticketFields__fieldStatusInactive"
  ],
  [
    "dialog",
    "ticketFields__dialog"
  ],
  [
    "dialogHeader",
    "ticketFields__dialogHeader"
  ],
  [
    "dialogTitle",
    "ticketFields__dialogTitle"
  ],
  [
    "dialogClose",
    "ticketFields__dialogClose"
  ],
  [
    "dialogCloseIcon",
    "ticketFields__dialogCloseIcon"
  ],
  [
    "dialogForm",
    "ticketFields__dialogForm"
  ],
  [
    "dialogError",
    "ticketFields__dialogError"
  ],
  [
    "dialogFields",
    "ticketFields__dialogFields"
  ],
  [
    "dialogLabel",
    "ticketFields__dialogLabel"
  ],
  [
    "dialogControl",
    "ticketFields__dialogControl"
  ],
  [
    "dialogHelp",
    "ticketFields__dialogHelp"
  ],
  [
    "optionsReveal",
    "ticketFields__optionsReveal"
  ],
  [
    "checkbox",
    "ticketFields__checkbox"
  ],
  [
    "dialogActions",
    "ticketFields__dialogActions"
  ],
  [
    "dialogCancel",
    "ticketFields__dialogCancel"
  ],
  [
    "dialogSubmit",
    "ticketFields__dialogSubmit"
  ]
]
const ticketFieldsSlotFns = /* @__PURE__ */ ticketFieldsSlotNames.map(([slotName, slotKey]) => [slotName, createRecipe(slotKey, ticketFieldsDefaultVariants, getSlotCompoundVariant(ticketFieldsCompoundVariants, slotName))])

const ticketFieldsFn = memo((props = {}) => {
  return Object.fromEntries(ticketFieldsSlotFns.map(([slotName, slotFn]) => [slotName, slotFn.recipeFn(props)]))
})

const ticketFieldsVariantKeys = []
const getVariantProps = (variants) => ({ ...ticketFieldsDefaultVariants, ...compact(variants) })

export const ticketFields = /* @__PURE__ */ Object.assign(ticketFieldsFn, {
  __recipe__: false,
  __name__: 'ticketFields',
  raw: (props) => props,
  classNameMap: {},
  variantKeys: ticketFieldsVariantKeys,
  variantMap: {},
  splitVariantProps(props) {
    return splitProps(props, ticketFieldsVariantKeys)
  },
  getVariantProps
})