import { compact, getSlotCompoundVariant, memo, splitProps } from '../helpers.mjs';
import { createRecipe } from './create-recipe.mjs';

const scrollAreaDefaultVariants = {
  "size": "md",
  "scrollbar": "auto"
}
const scrollAreaCompoundVariants = []

const scrollAreaSlotNames = [
  [
    "root",
    "scroll-area__root"
  ],
  [
    "viewport",
    "scroll-area__viewport"
  ],
  [
    "content",
    "scroll-area__content"
  ],
  [
    "scrollbar",
    "scroll-area__scrollbar"
  ],
  [
    "thumb",
    "scroll-area__thumb"
  ],
  [
    "corner",
    "scroll-area__corner"
  ]
]
const scrollAreaSlotFns = /* @__PURE__ */ scrollAreaSlotNames.map(([slotName, slotKey]) => [slotName, createRecipe(slotKey, scrollAreaDefaultVariants, getSlotCompoundVariant(scrollAreaCompoundVariants, slotName))])

const scrollAreaFn = memo((props = {}) => {
  return Object.fromEntries(scrollAreaSlotFns.map(([slotName, slotFn]) => [slotName, slotFn.recipeFn(props)]))
})

const scrollAreaVariantKeys = [
  "scrollbar",
  "size"
]
const getVariantProps = (variants) => ({ ...scrollAreaDefaultVariants, ...compact(variants) })

export const scrollArea = /* @__PURE__ */ Object.assign(scrollAreaFn, {
  __recipe__: false,
  __name__: 'scrollArea',
  raw: (props) => props,
  classNameMap: {},
  variantKeys: scrollAreaVariantKeys,
  variantMap: {
  "scrollbar": [
    "auto",
    "visible"
  ],
  "size": [
    "xs",
    "sm",
    "md",
    "lg"
  ]
},
  splitVariantProps(props) {
    return splitProps(props, scrollAreaVariantKeys)
  },
  getVariantProps
})