import { createListCollection } from '@ark-ui/react';
import { ParkSelect } from '@luminatick/ui/park';
import { useMemo, type Ref } from 'react';

type Option = { label: string; value: string };

interface DashboardSelectProps {
  options: Option[];
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  label?: string;
  name?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
  className?: string;
  triggerRef?: Ref<HTMLButtonElement>;
}

/** Dashboard forms compose the installed Park Select anatomy with string-valued data. */
export function DashboardSelect({ options, value, onValueChange, id, label, name, disabled, autoFocus, className, triggerRef, ...aria }: DashboardSelectProps) {
  const collection = useMemo(() => createListCollection({ items: options }), [options]);
  return (
    <ParkSelect.Root collection={collection} value={[value]} disabled={disabled}
      onValueChange={({ value: next }) => onValueChange(next[0] ?? '')} className={className}>
      {label && <ParkSelect.Label>{label}</ParkSelect.Label>}
      <ParkSelect.Control>
        <ParkSelect.Trigger ref={triggerRef} id={id} autoFocus={autoFocus} aria-label={aria['aria-label']} aria-describedby={aria['aria-describedby']}>
          <ParkSelect.ValueText />
        </ParkSelect.Trigger>
        <ParkSelect.IndicatorGroup><ParkSelect.Indicator /></ParkSelect.IndicatorGroup>
      </ParkSelect.Control>
      <ParkSelect.HiddenSelect name={name} />
      <ParkSelect.Positioner>
        <ParkSelect.Content>
          <ParkSelect.List>
            {options.map(option => (
              <ParkSelect.Item key={option.value} item={option}>
                <ParkSelect.ItemText>{option.label}</ParkSelect.ItemText>
                <ParkSelect.ItemIndicator />
              </ParkSelect.Item>
            ))}
          </ParkSelect.List>
        </ParkSelect.Content>
      </ParkSelect.Positioner>
    </ParkSelect.Root>
  );
}
