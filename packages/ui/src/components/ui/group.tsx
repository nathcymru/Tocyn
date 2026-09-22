import { ark } from '@ark-ui/react'
import type { ComponentProps } from 'react'
import { styled } from '../../styles/generated/jsx'
import { group } from '../../styles/generated/recipes'

export type GroupProps = ComponentProps<typeof Group>
export const Group = styled(ark.div, group)
