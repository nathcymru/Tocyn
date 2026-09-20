import { Field } from '@ark-ui/react/field'
import type { ComponentProps } from 'react'
import { styled } from '../../styles/generated/jsx'
import { input } from '../../styles/generated/recipes'

export type InputProps = ComponentProps<typeof Input>
export const Input = styled(Field.Input, input)
