import React from 'react';
import { icon as iconRecipe } from './styles/generated/recipes';
import {
  AlignLeft, ArrowLeft as ArrowLeftGlyph, ArrowRight, ArrowSquareOut, ArrowsClockwise, Bell as BellGlyph, BookOpen,
  Buildings, Calendar as CalendarGlyph, ChartBar, ChartLine, Check as CheckGlyph, CheckCircle, CheckSquare, CircleNotch, ChatCircle, CaretDown, CaretLeft, CaretRight, House, Books,
  Clock as ClockGlyph, Cloud, Columns, Copy as CopyGlyph, Cpu, CreditCard, Database, DotsThreeVertical, Envelope,
  Eye as EyeGlyph, FileText, FloppyDisk, Folder, Funnel, Gear, HardDrive, Info as InfoGlyph, Key as KeyGlyph, Lightning,
  List, ListBullets, MagnifyingGlass, Paperclip as PaperclipGlyph, PaperPlaneTilt, PencilSimple, Plus as PlusGlyph,
  Shield as ShieldGlyph, ShieldCheck as ShieldCheckGlyph, SignOut, TextT, Textbox, Ticket as TicketGlyph, TreeStructure,
  Trash, ToggleLeft, ToggleRight, User as UserGlyph, UserPlus, Users as UsersGlyph, Warning, WarningCircle,
  WifiHigh, X as XGlyph, type IconProps,
} from '@phosphor-icons/react';

/** Park Icon contract for custom SVGs and library icons. */
export function ParkIcon({ children, className, size = 20, ...props }: React.SVGProps<SVGSVGElement> & { size?: number; children?: React.ReactNode }) {
  return <svg {...props} width={size} height={size} viewBox="0 0 24 24" className={[iconRecipe(), className].filter(Boolean).join(' ')} aria-hidden={props['aria-label'] ? undefined : true}>{children}</svg>;
}

/** Shared icon boundary: application icons are duotone and inherit semantic colour. */
function duotone(Icon: any) {
  return React.forwardRef<SVGSVGElement, any>((props, ref) => (
    <Icon {...props} ref={ref} weight="duotone" className={[iconRecipe(), props.className].filter(Boolean).join(' ')} aria-hidden={props['aria-label'] ? undefined : true} />
  ));
}

export type TocynIconProps = IconProps;
export const IconAlignLeft = duotone(AlignLeft);
export const IconArrowLeft = duotone(ArrowLeftGlyph);
export const IconArrowRight = duotone(ArrowRight);
export const IconArrowUpRightFromSquare = duotone(ArrowSquareOut);
export const IconArrowRightFromBracket = duotone(SignOut);
export const IconArrowsRotate = duotone(ArrowsClockwise);
export const IconBars = duotone(List);
export const IconBell = duotone(BellGlyph);
export const IconBolt = duotone(Lightning);
export const IconBook = duotone(BookOpen);
export const IconBooks = duotone(Books);
export const IconBuilding = duotone(Buildings);
export const IconCalendar = duotone(CalendarGlyph);
export const IconChartBar = duotone(ChartBar);
export const IconChartLine = duotone(ChartLine);
export const IconCheck = duotone(CheckGlyph);
export const IconChevronDown = duotone(CaretDown);
export const IconChevronLeft = duotone(CaretLeft);
export const IconChevronRight = duotone(CaretRight);
export const IconCircleCheck = duotone(CheckCircle);
export const IconCircleExclamation = duotone(WarningCircle);
export const IconCircleInfo = duotone(InfoGlyph);
export const IconClock = duotone(ClockGlyph);
export const IconCloud = duotone(Cloud);
export const IconCopy = duotone(CopyGlyph);
export const IconCreditCard = duotone(CreditCard);
export const IconDatabase = duotone(Database);
export const IconDiagramProject = duotone(TreeStructure);
export const IconEllipsisVertical = duotone(DotsThreeVertical);
export const IconEnvelope = duotone(Envelope);
export const IconEye = duotone(EyeGlyph);
export const IconFileLines = duotone(FileText);
export const IconFilter = duotone(Funnel);
export const IconFloppyDisk = duotone(FloppyDisk);
export const IconFolder = duotone(Folder);
export const IconFont = duotone(TextT);
export const IconGear = duotone(Gear);
export const IconHardDrive = duotone(HardDrive);
export const IconKey = duotone(KeyGlyph);
export const IconHouse = duotone(House);
export const IconList = duotone(ListBullets);
export const IconMagnifyingGlass = duotone(MagnifyingGlass);
export const IconMessage = duotone(ChatCircle);
export const IconMicrochip = duotone(Cpu);
export const IconPaperPlane = duotone(PaperPlaneTilt);
export const IconPaperclip = duotone(PaperclipGlyph);
export const IconPenToSquare = duotone(PencilSimple);
export const IconPlus = duotone(PlusGlyph);
export const IconRightFromBracket = duotone(SignOut);
export const IconShield = duotone(ShieldGlyph);
export const IconShieldHalved = duotone(ShieldCheckGlyph);
export const IconSpinner = duotone(CircleNotch);
export const IconSquareCheck = duotone(CheckSquare);
export const IconTableColumns = duotone(Columns);
export const IconTicket = duotone(TicketGlyph);
export const IconToggleOff = duotone(ToggleLeft);
export const IconToggleOn = duotone(ToggleRight);
export const IconTrash = duotone(Trash);
export const IconTriangleExclamation = duotone(Warning);
export const IconUser = duotone(UserGlyph);
export const IconUserPlus = duotone(UserPlus);
export const IconUsers = duotone(UsersGlyph);
export const IconWifi = duotone(WifiHigh);
export const IconWpforms = duotone(Textbox);
export const IconXmark = duotone(XGlyph);

// Semantic names for new code.
export const MagnifyingGlassIcon = duotone(MagnifyingGlass);
export const TicketIcon = duotone(TicketGlyph);

// Compatibility names used by migrated route modules. They remain inside the
// shared Phosphor boundary so routes never import a vendor icon package.
export const Plus = IconPlus;
export const Filter = IconFilter;
export const MoreVertical = IconEllipsisVertical;
export const AlertCircle = IconCircleExclamation;
export const X = IconXmark;
export const ChevronLeft = IconChevronLeft;
export const ChevronRight = IconChevronRight;
export const Search = IconMagnifyingGlass;
export const LayoutList = IconList;
export const CopyIcon = IconCopy;
export const CheckIcon = IconCheck;
export const Copy = IconCopy;
export const Check = IconCheck;
export const ArrowLeft = IconArrowLeft;
export const Send = IconPaperPlane;
export const User = IconUser;
export const ShieldCheck = IconShieldHalved;
export const MessageSquare = IconMessage;
export const Mail = IconEnvelope;
export const Activity = IconChartLine;
export const Paperclip = IconPaperclip;
export const ClockIcon = IconClock;
export const Clock = IconClock;
export const Settings = IconGear;
export const Table2 = IconTableColumns;
export const LayoutDashboard = IconChartLine;
export const Ticket = IconTicket;
export const Users = IconUsers;
export const Key = IconKey;
export const LogOut = IconRightFromBracket;
export const Book = IconBook;
export const BooksIcon = IconBooks;
export const HouseIcon = IconHouse;
export const Menu = IconBars;
export const WifiOff = IconWifi;
export const Bell = IconBell;
export const ChevronDown = IconChevronDown;
export const RefreshCw = IconArrowsRotate;
export const Eye = IconEye;
export const Info = IconCircleInfo;
export const Shield = IconShield;
export const Calendar = IconCalendar;
