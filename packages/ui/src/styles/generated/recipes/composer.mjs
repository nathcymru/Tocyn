import { compact, getSlotCompoundVariant, memo, splitProps } from '../helpers.mjs';
import { createRecipe } from './create-recipe.mjs';

const composerDefaultVariants = {}
const composerCompoundVariants = []

const composerSlotNames = [
  [
    "root",
    "composer__root"
  ],
  [
    "formatHelp",
    "composer__formatHelp"
  ],
  [
    "markdown",
    "composer__markdown"
  ],
  [
    "toolbar",
    "composer__toolbar"
  ],
  [
    "toolbarButton",
    "composer__toolbarButton"
  ],
  [
    "input",
    "composer__input"
  ],
  [
    "editor",
    "composer__editor"
  ],
  [
    "autocomplete",
    "composer__autocomplete"
  ],
  [
    "autocompleteOption",
    "composer__autocompleteOption"
  ],
  [
    "dropHelp",
    "composer__dropHelp"
  ],
  [
    "preview",
    "composer__preview"
  ],
  [
    "previewSummary",
    "composer__previewSummary"
  ],
  [
    "previewBody",
    "composer__previewBody"
  ]
]
const composerSlotFns = /* @__PURE__ */ composerSlotNames.map(([slotName, slotKey]) => [slotName, createRecipe(slotKey, composerDefaultVariants, getSlotCompoundVariant(composerCompoundVariants, slotName))])

const composerFn = memo((props = {}) => {
  return Object.fromEntries(composerSlotFns.map(([slotName, slotFn]) => [slotName, slotFn.recipeFn(props)]))
})

const composerVariantKeys = []
const getVariantProps = (variants) => ({ ...composerDefaultVariants, ...compact(variants) })

export const composer = /* @__PURE__ */ Object.assign(composerFn, {
  __recipe__: false,
  __name__: 'composer',
  raw: (props) => props,
  classNameMap: {},
  variantKeys: composerVariantKeys,
  variantMap: {},
  splitVariantProps(props) {
    return splitProps(props, composerVariantKeys)
  },
  getVariantProps
})