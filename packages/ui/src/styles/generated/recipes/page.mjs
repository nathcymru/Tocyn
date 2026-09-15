import { compact, getSlotCompoundVariant, memo, splitProps } from '../helpers.mjs';
import { createRecipe } from './create-recipe.mjs';

const pageDefaultVariants = {
  "kind": "dashboard"
}
const pageCompoundVariants = []

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