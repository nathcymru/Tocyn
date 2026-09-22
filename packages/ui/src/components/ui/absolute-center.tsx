import { ark } from '@ark-ui/react/factory'
import type { ComponentProps } from 'react'
import { styled } from '../../styles/generated/jsx'
import { absoluteCenter } from '../../styles/generated/recipes'

export type AbsoluteCenterProps = ComponentProps<typeof AbsoluteCenter>
export const AbsoluteCenter = styled(ark.div, absoluteCenter)
