import { compact, getSlotCompoundVariant, memo, splitProps } from '../helpers.mjs';
import { createRecipe } from './create-recipe.mjs';

const alertDefaultVariants = {
  "size": "md",
  "status": "info",
  "variant": "subtle"
}
const alertCompoundVariants = []

const alertSlotNames = [
  [
    "root",
    "alert__root"
  ],
  [
    "content",
    "alert__content"
  ],
  [
    "description",
    "alert__description"
  ],
  [
    "indicator",
    "alert__indicator"
  ],
  [
    "title",
    "alert__title"
  ]
]
const alertSlotFns = /* @__PURE__ */ alertSlotNames.map(([slotName, slotKey]) => [slotName, createRecipe(slotKey, alertDefaultVariants, getSlotCompoundVariant(alertCompoundVariants, slotName))])

const alertFn = memo((props = {}) => {
  return Object.fromEntries(alertSlotFns.map(([slotName, slotFn]) => [slotName, slotFn.recipeFn(props)]))
})

const alertVariantKeys = [
  "size",
  "variant",
  "status"
]
const getVariantProps = (variants) => ({ ...alertDefaultVariants, ...compact(variants) })

export const alert = /* @__PURE__ */ Object.assign(alertFn, {
  __recipe__: false,
  __name__: 'alert',
  raw: (props) => props,
  classNameMap: {},
  variantKeys: alertVariantKeys,
  variantMap: {
  "size": [
    "md",
    "lg"
  ],
  "variant": [
    "solid",
    "surface",
    "subtle",
    "outline"
  ],
  "status": [
    "info",
    "warning",
    "success",
    "error",
    "neutral"
  ]
},
  splitVariantProps(props) {
    return splitProps(props, alertVariantKeys)
  },
  getVariantProps
})