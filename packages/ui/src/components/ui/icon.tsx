import { ark } from '@ark-ui/react/factory'
import type { ComponentProps } from 'react'
import { styled } from '../../styles/generated/jsx'
import { icon } from '../../styles/generated/recipes'

export type IconProps = ComponentProps<typeof Icon>
export const Icon = styled(ark.svg, icon, {
  defaultProps: { asChild: true },
})
