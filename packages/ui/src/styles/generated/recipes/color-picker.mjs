import { compact, getSlotCompoundVariant, memo, splitProps } from '../helpers.mjs';
import { createRecipe } from './create-recipe.mjs';

const colorPickerDefaultVariants = {}
const colorPickerCompoundVariants = []

const colorPickerSlotNames = [
  [
    "root",
    "color-picker__root"
  ],
  [
    "label",
    "color-picker__label"
  ],
  [
    "control",
    "color-picker__control"
  ],
  [
    "trigger",
    "color-picker__trigger"
  ],
  [
    "positioner",
    "color-picker__positioner"
  ],
  [
    "content",
    "color-picker__content"
  ],
  [
    "area",
    "color-picker__area"
  ],
  [
    "areaThumb",
    "color-picker__areaThumb"
  ],
  [
    "valueText",
    "color-picker__valueText"
  ],
  [
    "areaBackground",
    "color-picker__areaBackground"
  ],
  [
    "channelSlider",
    "color-picker__channelSlider"
  ],
  [
    "channelSliderLabel",
    "color-picker__channelSliderLabel"
  ],
  [
    "channelSliderTrack",
    "color-picker__channelSliderTrack"
  ],
  [
    "channelSliderThumb",
    "color-picker__channelSliderThumb"
  ],
  [
    "channelSliderValueText",
    "color-picker__channelSliderValueText"
  ],
  [
    "channelInput",
    "color-picker__channelInput"
  ],
  [
    "transparencyGrid",
    "color-picker__transparencyGrid"
  ],
  [
    "swatchGroup",
    "color-picker__swatchGroup"
  ],
  [
    "swatchTrigger",
    "color-picker__swatchTrigger"
  ],
  [
    "swatchIndicator",
    "color-picker__swatchIndicator"
  ],
  [
    "swatch",
    "color-picker__swatch"
  ],
  [
    "eyeDropperTrigger",
    "color-picker__eyeDropperTrigger"
  ],
  [
    "formatTrigger",
    "color-picker__formatTrigger"
  ],
  [
    "formatSelect",
    "color-picker__formatSelect"
  ],
  [
    "view",
    "color-picker__view"
  ]
]
const colorPickerSlotFns = /* @__PURE__ */ colorPickerSlotNames.map(([slotName, slotKey]) => [slotName, createRecipe(slotKey, colorPickerDefaultVariants, getSlotCompoundVariant(colorPickerCompoundVariants, slotName))])

const colorPickerFn = memo((props = {}) => {
  return Object.fromEntries(colorPickerSlotFns.map(([slotName, slotFn]) => [slotName, slotFn.recipeFn(props)]))
})

const colorPickerVariantKeys = []
const getVariantProps = (variants) => ({ ...colorPickerDefaultVariants, ...compact(variants) })

export const colorPicker = /* @__PURE__ */ Object.assign(colorPickerFn, {
  __recipe__: false,
  __name__: 'colorPicker',
  raw: (props) => props,
  classNameMap: {},
  variantKeys: colorPickerVariantKeys,
  variantMap: {},
  splitVariantProps(props) {
    return splitProps(props, colorPickerVariantKeys)
  },
  getVariantProps
})