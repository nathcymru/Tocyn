import type { ComponentProps } from 'react'
import { styled } from '../../styles/generated/jsx'
import { type TextVariantProps, text } from '../../styles/generated/recipes'
import type { StyledComponent } from '../../styles/generated/types'

type Props = TextVariantProps & { as?: React.ElementType }

export type TextProps = ComponentProps<typeof Text>
export const Text = styled('p', text) as StyledComponent<'p', Props>
