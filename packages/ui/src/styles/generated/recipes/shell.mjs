import { compact, getSlotCompoundVariant, memo, splitProps } from '../helpers.mjs';
import { createRecipe } from './create-recipe.mjs';

const shellDefaultVariants = {}
const shellCompoundVariants = []

const shellSlotNames = [
  [
    "root",
    "shell__root"
  ],
  [
    "sidebar",
    "shell__sidebar"
  ],
  [
    "main",
    "shell__main"
  ],
  [
    "header",
    "shell__header"
  ],
  [
    "content",
    "shell__content"
  ],
  [
    "navigation",
    "shell__navigation"
  ],
  [
    "navigationLink",
    "shell__navigationLink"
  ],
  [
    "sidebarDesktop",
    "shell__sidebarDesktop"
  ],
  [
    "sidebarLabelled",
    "shell__sidebarLabelled"
  ],
  [
    "sidebarCompact",
    "shell__sidebarCompact"
  ],
  [
    "logoLink",
    "shell__logoLink"
  ],
  [
    "logo",
    "shell__logo"
  ],
  [
    "mobileDialog",
    "shell__mobileDialog"
  ],
  [
    "mobileContent",
    "shell__mobileContent"
  ],
  [
    "mobileClose",
    "shell__mobileClose"
  ],
  [
    "mobileTrigger",
    "shell__mobileTrigger"
  ],
  [
    "personaTrigger",
    "shell__personaTrigger"
  ],
  [
    "personaAvatar",
    "shell__personaAvatar"
  ],
  [
    "personaStatus",
    "shell__personaStatus"
  ],
  [
    "accountMenu",
    "shell__accountMenu"
  ],
  [
    "accountSummary",
    "shell__accountSummary"
  ],
  [
    "accountSummaryName",
    "shell__accountSummaryName"
  ],
  [
    "accountSummaryEmail",
    "shell__accountSummaryEmail"
  ],
  [
    "menuItem",
    "shell__menuItem"
  ],
  [
    "activityTrigger",
    "shell__activityTrigger"
  ],
  [
    "activityPopover",
    "shell__activityPopover"
  ],
  [
    "connectionWrap",
    "shell__connectionWrap"
  ],
  [
    "connectionPopover",
    "shell__connectionPopover"
  ],
  [
    "rootInbox",
    "shell__rootInbox"
  ],
  [
    "rootStandard",
    "shell__rootStandard"
  ],
  [
    "contentInbox",
    "shell__contentInbox"
  ],
  [
    "contentStandard",
    "shell__contentStandard"
  ],
  [
    "contentPadded",
    "shell__contentPadded"
  ]
]
const shellSlotFns = /* @__PURE__ */ shellSlotNames.map(([slotName, slotKey]) => [slotName, createRecipe(slotKey, shellDefaultVariants, getSlotCompoundVariant(shellCompoundVariants, slotName))])

const shellFn = memo((props = {}) => {
  return Object.fromEntries(shellSlotFns.map(([slotName, slotFn]) => [slotName, slotFn.recipeFn(props)]))
})

const shellVariantKeys = []
const getVariantProps = (variants) => ({ ...shellDefaultVariants, ...compact(variants) })

export const shell = /* @__PURE__ */ Object.assign(shellFn, {
  __recipe__: false,
  __name__: 'shell',
  raw: (props) => props,
  classNameMap: {},
  variantKeys: shellVariantKeys,
  variantMap: {},
  splitVariantProps(props) {
    return splitProps(props, shellVariantKeys)
  },
  getVariantProps
})