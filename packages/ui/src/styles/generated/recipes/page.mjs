import { compact, getSlotCompoundVariant, memo, splitProps } from '../helpers.mjs';
import { createRecipe } from './create-recipe.mjs';

const pageDefaultVariants = {
  "kind": "dashboard"
}
const pageCompoundVariants = [
  {
    "kind": "settings",
    "css": {
      "grid": {
        "gridTemplateColumns": "1fr"
      },
      "settingsSections": {
        "maxWidth": "56rem",
        "marginInline": "auto"
      }
    }
  },
  {
    "kind": "knowledge",
    "css": {
      "knowledgeWorkspace": {
        "gridTemplateColumns": "minmax(15rem, 20rem) minmax(0, 1fr)"
      }
    }
  },
  {
    "kind": "inbox",
    "css": {
      "inboxControls": {
        "gridTemplateColumns": "repeat(3, minmax(0, 1fr))"
      }
    }
  }
]

const pageSlotNames = [
  [
    "root",
    "page__root"
  ],
  [
    "header",
    "page__header"
  ],
  [
    "content",
    "page__content"
  ],
  [
    "grid",
    "page__grid"
  ],
  [
    "section",
    "page__section"
  ],
  [
    "settingsSections",
    "page__settingsSections"
  ],
  [
    "settingsField",
    "page__settingsField"
  ],
  [
    "settingsError",
    "page__settingsError"
  ],
  [
    "settingsHelp",
    "page__settingsHelp"
  ],
  [
    "knowledgeWorkspace",
    "page__knowledgeWorkspace"
  ],
  [
    "knowledgeSidebar",
    "page__knowledgeSidebar"
  ],
  [
    "knowledgeContent",
    "page__knowledgeContent"
  ],
  [
    "knowledgeTable",
    "page__knowledgeTable"
  ],
  [
    "knowledgeRow",
    "page__knowledgeRow"
  ],
  [
    "knowledgeSearch",
    "page__knowledgeSearch"
  ],
  [
    "knowledgePreview",
    "page__knowledgePreview"
  ],
  [
    "knowledgeCategoryRow",
    "page__knowledgeCategoryRow"
  ],
  [
    "knowledgeCategoryRowSelected",
    "page__knowledgeCategoryRowSelected"
  ],
  [
    "knowledgeCategoryMain",
    "page__knowledgeCategoryMain"
  ],
  [
    "knowledgeCategoryActions",
    "page__knowledgeCategoryActions"
  ],
  [
    "knowledgeCategoryChildren",
    "page__knowledgeCategoryChildren"
  ],
  [
    "knowledgeCategoryList",
    "page__knowledgeCategoryList"
  ],
  [
    "knowledgeCategorySpacer",
    "page__knowledgeCategorySpacer"
  ],
  [
    "knowledgeCategoryButton",
    "page__knowledgeCategoryButton"
  ],
  [
    "knowledgeDeleteActions",
    "page__knowledgeDeleteActions"
  ],
  [
    "knowledgeStatusBadge",
    "page__knowledgeStatusBadge"
  ],
  [
    "accountGrid",
    "page__accountGrid"
  ],
  [
    "accountIdentityName",
    "page__accountIdentityName"
  ],
  [
    "accountIdentityEmail",
    "page__accountIdentityEmail"
  ],
  [
    "inboxWorkspace",
    "page__inboxWorkspace"
  ],
  [
    "inboxList",
    "page__inboxList"
  ],
  [
    "inboxDetail",
    "page__inboxDetail"
  ],
  [
    "inboxHeader",
    "page__inboxHeader"
  ],
  [
    "inboxControls",
    "page__inboxControls"
  ],
  [
    "inboxMetrics",
    "page__inboxMetrics"
  ],
  [
    "inboxSearch",
    "page__inboxSearch"
  ],
  [
    "inboxToolbar",
    "page__inboxToolbar"
  ],
  [
    "inboxRows",
    "page__inboxRows"
  ],
  [
    "inboxRow",
    "page__inboxRow"
  ],
  [
    "inboxTable",
    "page__inboxTable"
  ],
  [
    "inboxEmpty",
    "page__inboxEmpty"
  ],
  [
    "inboxMobileHidden",
    "page__inboxMobileHidden"
  ],
  [
    "inboxTableMobileHidden",
    "page__inboxTableMobileHidden"
  ],
  [
    "inboxStatus",
    "page__inboxStatus"
  ],
  [
    "inboxPriority",
    "page__inboxPriority"
  ],
  [
    "metricStrip",
    "page__metricStrip"
  ],
  [
    "metricCard",
    "page__metricCard"
  ],
  [
    "metricIcon",
    "page__metricIcon"
  ],
  [
    "panels",
    "page__panels"
  ],
  [
    "priorityList",
    "page__priorityList"
  ],
  [
    "priorityRow",
    "page__priorityRow"
  ],
  [
    "progressTrack",
    "page__progressTrack"
  ],
  [
    "progressFill",
    "page__progressFill"
  ],
  [
    "overviewGrid",
    "page__overviewGrid"
  ],
  [
    "overviewCard",
    "page__overviewCard"
  ],
  [
    "overviewFooter",
    "page__overviewFooter"
  ]
]
const pageSlotFns = /* @__PURE__ */ pageSlotNames.map(([slotName, slotKey]) => [slotName, createRecipe(slotKey, pageDefaultVariants, getSlotCompoundVariant(pageCompoundVariants, slotName))])

const pageFn = memo((props = {}) => {
  return Object.fromEntries(pageSlotFns.map(([slotName, slotFn]) => [slotName, slotFn.recipeFn(props)]))
})

const pageVariantKeys = [
  "kind"
]
const getVariantProps = (variants) => ({ ...pageDefaultVariants, ...compact(variants) })

export const page = /* @__PURE__ */ Object.assign(pageFn, {
  __recipe__: false,
  __name__: 'page',
  raw: (props) => props,
  classNameMap: {},
  variantKeys: pageVariantKeys,
  variantMap: {
  "kind": [
    "dashboard",
    "knowledge",
    "inbox",
    "settings",
    "account"
  ]
},
  splitVariantProps(props) {
    return splitProps(props, pageVariantKeys)
  },
  getVariantProps
})