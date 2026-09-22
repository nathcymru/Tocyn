import { ark } from '@ark-ui/react/factory'
import type { ComponentProps } from 'react'
import { styled } from '../../styles/generated/jsx'
import { code } from '../../styles/generated/recipes'

export type CodeProps = ComponentProps<typeof Code>
export const Code = styled(ark.code, code)
