import { compact, getSlotCompoundVariant, memo, splitProps } from '../helpers.mjs';
import { createRecipe } from './create-recipe.mjs';

const emptyStateDefaultVariants = {}
const emptyStateCompoundVariants = []

const emptyStateSlotNames = [
  [
    "root",
    "emptyState__root"
  ],
  [
    "title",
    "emptyState__title"
  ],
  [
    "description",
    "emptyState__description"
  ],
  [
    "action",
    "emptyState__action"
  ]
]
const emptyStateSlotFns = /* @__PURE__ */ emptyStateSlotNames.map(([slotName, slotKey]) => [slotName, createRecipe(slotKey, emptyStateDefaultVariants, getSlotCompoundVariant(emptyStateCompoundVariants, slotName))])

const emptyStateFn = memo((props = {}) => {
  return Object.fromEntries(emptyStateSlotFns.map(([slotName, slotFn]) => [slotName, slotFn.recipeFn(props)]))
})

const emptyStateVariantKeys = []
const getVariantProps = (variants) => ({ ...emptyStateDefaultVariants, ...compact(variants) })

export const emptyState = /* @__PURE__ */ Object.assign(emptyStateFn, {
  __recipe__: false,
  __name__: 'emptyState',
  raw: (props) => props,
  classNameMap: {},
  variantKeys: emptyStateVariantKeys,
  variantMap: {},
  splitVariantProps(props) {
    return splitProps(props, emptyStateVariantKeys)
  },
  getVariantProps
})