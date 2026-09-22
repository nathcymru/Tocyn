import type { ComponentProps } from 'react'
import { styled } from '../../styles/generated/jsx'
import { type HeadingVariantProps, heading } from '../../styles/generated/recipes'
import type { StyledComponent } from '../../styles/generated/types'

type Props = HeadingVariantProps & { as?: React.ElementType }

export type HeadingProps = ComponentProps<typeof Heading>
export const Heading = styled('h2', heading) as StyledComponent<'h2', Props>
