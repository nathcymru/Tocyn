/** Park's registry components use Phosphor through Tocyn's duotone icon boundary. */
import { CaretUp, CaretUpDown, DotsThree, File as FileGlyph, Star, XCircle } from '@phosphor-icons/react';
import { IconCheck, IconChevronDown, IconChevronRight, IconCircleCheck, IconCircleExclamation, IconCircleInfo, IconCopy, IconUser, IconXmark } from '../icons';

export const CheckIcon = IconCheck;
export const ChevronDownIcon = IconChevronDown;
export const ChevronRightIcon = IconChevronRight;
export const CheckCircleIcon = IconCircleCheck;
export const CircleAlertIcon = IconCircleExclamation;
export const CircleXIcon = (props: React.ComponentProps<typeof XCircle>) => <XCircle {...props} weight="duotone" aria-hidden={props['aria-label'] ? undefined : true} />;
export const InfoIcon = IconCircleInfo;
export const CopyIcon = IconCopy;
export const XIcon = IconXmark;
export const UserIcon = IconUser;

export const ChevronsUpDownIcon = (props: React.ComponentProps<typeof CaretUpDown>) => <CaretUpDown {...props} weight="duotone" aria-hidden={props['aria-label'] ? undefined : true} />;
export const ChevronUpIcon = (props: React.ComponentProps<typeof CaretUp>) => <CaretUp {...props} weight="duotone" aria-hidden={props['aria-label'] ? undefined : true} />;
export const EllipsisIcon = (props: React.ComponentProps<typeof DotsThree>) => <DotsThree {...props} weight="duotone" aria-hidden={props['aria-label'] ? undefined : true} />;
export const FileIcon = (props: React.ComponentProps<typeof FileGlyph>) => <FileGlyph {...props} weight="duotone" aria-hidden={props['aria-label'] ? undefined : true} />;
export const StarIcon = (props: React.ComponentProps<typeof Star>) => <Star {...props} weight="duotone" aria-hidden={props['aria-label'] ? undefined : true} />;
