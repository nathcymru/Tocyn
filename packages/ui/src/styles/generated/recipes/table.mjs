import { compact, getSlotCompoundVariant, memo, splitProps } from '../helpers.mjs';
import { createRecipe } from './create-recipe.mjs';

const tableDefaultVariants = {
  "size": "md",
  "variant": "plain"
}
const tableCompoundVariants = []

const tableSlotNames = [
  [
    "root",
    "table__root"
  ],
  [
    "body",
    "table__body"
  ],
  [
    "cell",
    "table__cell"
  ],
  [
    "foot",
    "table__foot"
  ],
  [
    "head",
    "table__head"
  ],
  [
    "header",
    "table__header"
  ],
  [
    "row",
    "table__row"
  ],
  [
    "caption",
    "table__caption"
  ]
]
const tableSlotFns = /* @__PURE__ */ tableSlotNames.map(([slotName, slotKey]) => [slotName, createRecipe(slotKey, tableDefaultVariants, getSlotCompoundVariant(tableCompoundVariants, slotName))])

const tableFn = memo((props = {}) => {
  return Object.fromEntries(tableSlotFns.map(([slotName, slotFn]) => [slotName, slotFn.recipeFn(props)]))
})

const tableVariantKeys = [
  "variant",
  "striped",
  "interactive",
  "columnBorder",
  "stickyHeader",
  "size"
]
const getVariantProps = (variants) => ({ ...tableDefaultVariants, ...compact(variants) })

export const table = /* @__PURE__ */ Object.assign(tableFn, {
  __recipe__: false,
  __name__: 'table',
  raw: (props) => props,
  classNameMap: {},
  variantKeys: tableVariantKeys,
  variantMap: {
  "variant": [
    "surface",
    "plain"
  ],
  "striped": [
    "true"
  ],
  "interactive": [
    "true"
  ],
  "columnBorder": [
    "true"
  ],
  "stickyHeader": [
    "true"
  ],
  "size": [
    "md"
  ]
},
  splitVariantProps(props) {
    return splitProps(props, tableVariantKeys)
  },
  getVariantProps
})