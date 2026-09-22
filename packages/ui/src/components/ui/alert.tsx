'use client'
import { ark } from '@ark-ui/react/factory'
import { InfoIcon } from '../phosphor-icons'
import { type ComponentProps, forwardRef } from 'react'
import { createStyleContext } from '../../styles/generated/jsx'
import { alert } from '../../styles/generated/recipes'

const { withProvider, withContext } = createStyleContext(alert)

export type RootProps = ComponentProps<typeof Root>
export const Root = withProvider(ark.div, 'root')
export const Title = withContext(ark.h3, 'title')
export const Description = withContext(ark.div, 'description')
export const Content = withContext(ark.div, 'content')

type IndicatorProps = ComponentProps<typeof StyledIndicator>
const StyledIndicator = withContext(ark.span, 'indicator')

export const Indicator = forwardRef<HTMLSpanElement, IndicatorProps>(
  function Indicator({ children, ...props }, ref) {
    return (
      <StyledIndicator ref={ref} {...props}>
        {children ?? <InfoIcon />}
      </StyledIndicator>
    )
  },
)
