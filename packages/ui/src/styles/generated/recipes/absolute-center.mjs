import { memo, splitProps } from '../helpers.mjs';
import { createRecipe, mergeRecipes } from './create-recipe.mjs';

const absoluteCenterFn = /* @__PURE__ */ createRecipe('absolute-center', {
  "axis": "both"
}, [])

const absoluteCenterVariantMap = {
  "axis": [
    "horizontal",
    "vertical",
    "both"
  ]
}

const absoluteCenterVariantKeys = Object.keys(absoluteCenterVariantMap)

export const absoluteCenter = /* @__PURE__ */ Object.assign(memo(absoluteCenterFn.recipeFn), {
  __recipe__: true,
  __name__: 'absoluteCenter',
  __getCompoundVariantCss__: absoluteCenterFn.__getCompoundVariantCss__,
  raw: (props) => props,
  variantKeys: absoluteCenterVariantKeys,
  variantMap: absoluteCenterVariantMap,
  merge(recipe) {
    return mergeRecipes(this, recipe)
  },
  splitVariantProps(props) {
    return splitProps(props, absoluteCenterVariantKeys)
  },
  getVariantProps: absoluteCenterFn.getVariantProps,
})