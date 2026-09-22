import { ark } from '@ark-ui/react/factory'
import { styled } from '../../styles/generated/jsx'
import { kbd } from '../../styles/generated/recipes'
import type { ComponentProps } from '../../styles/generated/types'

export type KbdProps = ComponentProps<typeof Kbd>
export const Kbd = styled(ark.kbd, kbd)
