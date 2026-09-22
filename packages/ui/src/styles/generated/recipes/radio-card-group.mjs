import { compact, getSlotCompoundVariant, memo, splitProps } from '../helpers.mjs';
import { createRecipe } from './create-recipe.mjs';

const radioCardGroupDefaultVariants = {
  "variant": "outline",
  "size": "md"
}
const radioCardGroupCompoundVariants = []

const radioCardGroupSlotNames = [
  [
    "root",
    "radio-card-group__root"
  ],
  [
    "label",
    "radio-card-group__label"
  ],
  [
    "item",
    "radio-card-group__item"
  ],
  [
    "itemText",
    "radio-card-group__itemText"
  ],
  [
    "itemControl",
    "radio-card-group__itemControl"
  ],
  [
    "indicator",
    "radio-card-group__indicator"
  ]
]
const radioCardGroupSlotFns = /* @__PURE__ */ radioCardGroupSlotNames.map(([slotName, slotKey]) => [slotName, createRecipe(slotKey, radioCardGroupDefaultVariants, getSlotCompoundVariant(radioCardGroupCompoundVariants, slotName))])

const radioCardGroupFn = memo((props = {}) => {
  return Object.fromEntries(radioCardGroupSlotFns.map(([slotName, slotFn]) => [slotName, slotFn.recipeFn(props)]))
})

const radioCardGroupVariantKeys = [
  "variant",
  "size"
]
const getVariantProps = (variants) => ({ ...radioCardGroupDefaultVariants, ...compact(variants) })

export const radioCardGroup = /* @__PURE__ */ Object.assign(radioCardGroupFn, {
  __recipe__: false,
  __name__: 'radioCardGroup',
  raw: (props) => props,
  classNameMap: {},
  variantKeys: radioCardGroupVariantKeys,
  variantMap: {
  "variant": [
    "subtle",
    "outline",
    "surface",
    "solid"
  ],
  "size": [
    "md"
  ]
},
  splitVariantProps(props) {
    return splitProps(props, radioCardGroupVariantKeys)
  },
  getVariantProps
})