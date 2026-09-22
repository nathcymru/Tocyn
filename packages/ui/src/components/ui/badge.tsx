import { ark } from '@ark-ui/react/factory'
import type { ComponentProps } from 'react'
import { styled } from '../../styles/generated/jsx'
import { badge } from '../../styles/generated/recipes'

export type BadgeProps = ComponentProps<typeof Badge>
export const Badge = styled(ark.div, badge)
