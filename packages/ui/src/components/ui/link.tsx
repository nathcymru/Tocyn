import { ark } from '@ark-ui/react/factory'
import type { ComponentProps } from 'react'
import { styled } from '../../styles/generated/jsx'
import { link } from '../../styles/generated/recipes'

export type LinkProps = ComponentProps<typeof Link>
export const Link = styled(ark.a, link)
