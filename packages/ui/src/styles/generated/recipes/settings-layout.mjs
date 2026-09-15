import { compact, getSlotCompoundVariant, memo, splitProps } from '../helpers.mjs';
import { createRecipe } from './create-recipe.mjs';

const settingsLayoutDefaultVariants = {}
const settingsLayoutCompoundVariants = []

const settingsLayoutSlotNames = [
  [
    "root",
    "settingsLayout__root"
  ],
  [
    "sidebar",
    "settingsLayout__sidebar"
  ],
  [
    "sidebarInner",
    "settingsLayout__sidebarInner"
  ],
  [
    "title",
    "settingsLayout__title"
  ],
  [
    "nav",
    "settingsLayout__nav"
  ],
  [
    "navLink",
    "settingsLayout__navLink"
  ],
  [
    "navIcon",
    "settingsLayout__navIcon"
  ],
  [
    "sectionTitle",
    "settingsLayout__sectionTitle"
  ],
  [
    "main",
    "settingsLayout__main"
  ],
  [
    "content",
    "settingsLayout__content"
  ]
]
const settingsLayoutSlotFns = /* @__PURE__ */ settingsLayoutSlotNames.map(([slotName, slotKey]) => [slotName, createRecipe(slotKey, settingsLayoutDefaultVariants, getSlotCompoundVariant(settingsLayoutCompoundVariants, slotName))])

const settingsLayoutFn = memo((props = {}) => {
  return Object.fromEntries(settingsLayoutSlotFns.map(([slotName, slotFn]) => [slotName, slotFn.recipeFn(props)]))
})

const settingsLayoutVariantKeys = []
const getVariantProps = (variants) => ({ ...settingsLayoutDefaultVariants, ...compact(variants) })

export const settingsLayout = /* @__PURE__ */ Object.assign(settingsLayoutFn, {
  __recipe__: false,
  __name__: 'settingsLayout',
  raw: (props) => props,
  classNameMap: {},
  variantKeys: settingsLayoutVariantKeys,
  variantMap: {},
  splitVariantProps(props) {
    return splitProps(props, settingsLayoutVariantKeys)
  },
  getVariantProps
})