import { compact, getSlotCompoundVariant, memo, splitProps } from '../helpers.mjs';
import { createRecipe } from './create-recipe.mjs';

const knowledgeEditorDefaultVariants = {}
const knowledgeEditorCompoundVariants = []

const knowledgeEditorSlotNames = [
  [
    "root",
    "knowledgeEditor__root"
  ],
  [
    "header",
    "knowledgeEditor__header"
  ],
  [
    "heading",
    "knowledgeEditor__heading"
  ],
  [
    "back",
    "knowledgeEditor__back"
  ],
  [
    "title",
    "knowledgeEditor__title"
  ],
  [
    "save",
    "knowledgeEditor__save"
  ],
  [
    "spinner",
    "knowledgeEditor__spinner"
  ],
  [
    "content",
    "knowledgeEditor__content"
  ],
  [
    "stack",
    "knowledgeEditor__stack"
  ],
  [
    "error",
    "knowledgeEditor__error"
  ],
  [
    "card",
    "knowledgeEditor__card"
  ],
  [
    "fields",
    "knowledgeEditor__fields"
  ],
  [
    "field",
    "knowledgeEditor__field"
  ],
  [
    "control",
    "knowledgeEditor__control"
  ],
  [
    "tiptap",
    "knowledgeEditor__tiptap"
  ]
]
const knowledgeEditorSlotFns = /* @__PURE__ */ knowledgeEditorSlotNames.map(([slotName, slotKey]) => [slotName, createRecipe(slotKey, knowledgeEditorDefaultVariants, getSlotCompoundVariant(knowledgeEditorCompoundVariants, slotName))])

const knowledgeEditorFn = memo((props = {}) => {
  return Object.fromEntries(knowledgeEditorSlotFns.map(([slotName, slotFn]) => [slotName, slotFn.recipeFn(props)]))
})

const knowledgeEditorVariantKeys = []
const getVariantProps = (variants) => ({ ...knowledgeEditorDefaultVariants, ...compact(variants) })

export const knowledgeEditor = /* @__PURE__ */ Object.assign(knowledgeEditorFn, {
  __recipe__: false,
  __name__: 'knowledgeEditor',
  raw: (props) => props,
  classNameMap: {},
  variantKeys: knowledgeEditorVariantKeys,
  variantMap: {},
  splitVariantProps(props) {
    return splitProps(props, knowledgeEditorVariantKeys)
  },
  getVariantProps
})