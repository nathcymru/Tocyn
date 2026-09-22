import { Field } from '@ark-ui/react/field'
import type { ComponentProps } from 'react'
import { styled } from '../../styles/generated/jsx'
import { textarea } from '../../styles/generated/recipes'

export type TextareaProps = ComponentProps<typeof Textarea>
export const Textarea = styled(Field.Textarea, textarea)
