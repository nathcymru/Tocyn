import { ark } from '@ark-ui/react/factory'
import type { ComponentProps } from 'react'
import { styled } from '../../styles/generated/jsx'
import { spinner } from '../../styles/generated/recipes'

export type SpinnerProps = ComponentProps<typeof Spinner>
export const Spinner = styled(ark.span, spinner)
