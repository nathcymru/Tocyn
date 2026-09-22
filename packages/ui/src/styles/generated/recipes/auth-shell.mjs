import { compact, getSlotCompoundVariant, memo, splitProps } from '../helpers.mjs';
import { createRecipe } from './create-recipe.mjs';

const authShellDefaultVariants = {}
const authShellCompoundVariants = []

const authShellSlotNames = [
  [
    "root",
    "authShell__root"
  ],
  [
    "splash",
    "authShell__splash"
  ],
  [
    "image",
    "authShell__image"
  ],
  [
    "main",
    "authShell__main"
  ],
  [
    "form",
    "authShell__form"
  ],
  [
    "logo",
    "authShell__logo"
  ]
]
const authShellSlotFns = /* @__PURE__ */ authShellSlotNames.map(([slotName, slotKey]) => [slotName, createRecipe(slotKey, authShellDefaultVariants, getSlotCompoundVariant(authShellCompoundVariants, slotName))])

const authShellFn = memo((props = {}) => {
  return Object.fromEntries(authShellSlotFns.map(([slotName, slotFn]) => [slotName, slotFn.recipeFn(props)]))
})

const authShellVariantKeys = []
const getVariantProps = (variants) => ({ ...authShellDefaultVariants, ...compact(variants) })

export const authShell = /* @__PURE__ */ Object.assign(authShellFn, {
  __recipe__: false,
  __name__: 'authShell',
  raw: (props) => props,
  classNameMap: {},
  variantKeys: authShellVariantKeys,
  variantMap: {},
  splitVariantProps(props) {
    return splitProps(props, authShellVariantKeys)
  },
  getVariantProps
})