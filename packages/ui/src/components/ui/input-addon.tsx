import { ark } from '@ark-ui/react/factory'
import type { ComponentProps } from 'react'
import { styled } from '../../styles/generated/jsx'
import { inputAddon } from '../../styles/generated/recipes'

export type InputAddonProps = ComponentProps<typeof InputAddon>
export const InputAddon = styled(ark.div, inputAddon)
