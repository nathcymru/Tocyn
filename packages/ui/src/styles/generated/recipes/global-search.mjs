import { compact, getSlotCompoundVariant, memo, splitProps } from '../helpers.mjs';
import { createRecipe } from './create-recipe.mjs';

const globalSearchDefaultVariants = {}
const globalSearchCompoundVariants = []

const globalSearchSlotNames = [
  [
    "root",
    "globalSearch__root"
  ],
  [
    "inputShell",
    "globalSearch__inputShell"
  ],
  [
    "icon",
    "globalSearch__icon"
  ],
  [
    "input",
    "globalSearch__input"
  ],
  [
    "shortcut",
    "globalSearch__shortcut"
  ],
  [
    "divider",
    "globalSearch__divider"
  ],
  [
    "scope",
    "globalSearch__scope"
  ],
  [
    "clear",
    "globalSearch__clear"
  ],
  [
    "popover",
    "globalSearch__popover"
  ],
  [
    "status",
    "globalSearch__status"
  ],
  [
    "results",
    "globalSearch__results"
  ],
  [
    "result",
    "globalSearch__result"
  ],
  [
    "preview",
    "globalSearch__preview"
  ]
]
const globalSearchSlotFns = /* @__PURE__ */ globalSearchSlotNames.map(([slotName, slotKey]) => [slotName, createRecipe(slotKey, globalSearchDefaultVariants, getSlotCompoundVariant(globalSearchCompoundVariants, slotName))])

const globalSearchFn = memo((props = {}) => {
  return Object.fromEntries(globalSearchSlotFns.map(([slotName, slotFn]) => [slotName, slotFn.recipeFn(props)]))
})

const globalSearchVariantKeys = []
const getVariantProps = (variants) => ({ ...globalSearchDefaultVariants, ...compact(variants) })

export const globalSearch = /* @__PURE__ */ Object.assign(globalSearchFn, {
  __recipe__: false,
  __name__: 'globalSearch',
  raw: (props) => props,
  classNameMap: {},
  variantKeys: globalSearchVariantKeys,
  variantMap: {},
  splitVariantProps(props) {
    return splitProps(props, globalSearchVariantKeys)
  },
  getVariantProps
})