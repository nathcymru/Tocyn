import React from 'react';
import {
  AlignLeft, ArrowLeft as ArrowLeftGlyph, ArrowRight, ArrowSquareOut, ArrowsClockwise, Bell as BellGlyph, BookOpen,
  Buildings, Calendar as CalendarGlyph, ChartBar, ChartLine, Check as CheckGlyph, CheckCircle, CheckSquare, CircleNotch, ChatCircle, CaretDown, CaretLeft, CaretRight,
  Clock as ClockGlyph, Cloud, Columns, Copy as CopyGlyph, Cpu, CreditCard, Database, DotsThreeVertical, Envelope,
  Eye as EyeGlyph, FileText, FloppyDisk, Folder, Funnel, Gear, HardDrive, Info as InfoGlyph, Key as KeyGlyph, Lightning,
  List, ListBullets, MagnifyingGlass, Paperclip as PaperclipGlyph, PaperPlaneTilt, PencilSimple, Plus as PlusGlyph,
  Shield as ShieldGlyph, ShieldCheck as ShieldCheckGlyph, SignOut, TextT, Textbox, Ticket as TicketGlyph, TreeStructure,
  Trash, ToggleLeft, ToggleRight, User as UserGlyph, UserPlus, Users as UsersGlyph, Warning, WarningCircle,
  WifiHigh, X as XGlyph, type IconProps,
} from '@phosphor-icons/react';

/** Shared icon boundary: application icons are duotone and inherit semantic colour. */
function duotone(Icon: any) {
  return React.forwardRef<SVGSVGElement, any>((props, ref) => (
    <Icon {...props} ref={ref} weight="duotone" aria-hidden={props['aria-label'] ? undefined : true} />
  ));
}

export type TocynIconProps = IconProps;
export const FaAlignLeft = duotone(AlignLeft);
export const FaArrowLeft = duotone(ArrowLeftGlyph);
export const FaArrowRight = duotone(ArrowRight);
export const FaArrowUpRightFromSquare = duotone(ArrowSquareOut);
export const FaArrowRightFromBracket = duotone(SignOut);
export const FaArrowsRotate = duotone(ArrowsClockwise);
export const FaBars = duotone(List);
export const FaBell = duotone(BellGlyph);
export const FaBolt = duotone(Lightning);
export const FaBook = duotone(BookOpen);
export const FaBuilding = duotone(Buildings);
export const FaCalendar = duotone(CalendarGlyph);
export const FaChartBar = duotone(ChartBar);
export const FaChartLine = duotone(ChartLine);
export const FaCheck = duotone(CheckGlyph);
export const FaChevronDown = duotone(CaretDown);
export const FaChevronLeft = duotone(CaretLeft);
export const FaChevronRight = duotone(CaretRight);
export const FaCircleCheck = duotone(CheckCircle);
export const FaCircleExclamation = duotone(WarningCircle);
export const FaCircleInfo = duotone(InfoGlyph);
export const FaClock = duotone(ClockGlyph);
export const FaCloud = duotone(Cloud);
export const FaCopy = duotone(CopyGlyph);
export const FaCreditCard = duotone(CreditCard);
export const FaDatabase = duotone(Database);
export const FaDiagramProject = duotone(TreeStructure);
export const FaEllipsisVertical = duotone(DotsThreeVertical);
export const FaEnvelope = duotone(Envelope);
export const FaEye = duotone(EyeGlyph);
export const FaFileLines = duotone(FileText);
export const FaFilter = duotone(Funnel);
export const FaFloppyDisk = duotone(FloppyDisk);
export const FaFolder = duotone(Folder);
export const FaFont = duotone(TextT);
export const FaGear = duotone(Gear);
export const FaHardDrive = duotone(HardDrive);
export const FaKey = duotone(KeyGlyph);
export const FaList = duotone(ListBullets);
export const FaMagnifyingGlass = duotone(MagnifyingGlass);
export const FaMessage = duotone(ChatCircle);
export const FaMicrochip = duotone(Cpu);
export const FaPaperPlane = duotone(PaperPlaneTilt);
export const FaPaperclip = duotone(PaperclipGlyph);
export const FaPenToSquare = duotone(PencilSimple);
export const FaPlus = duotone(PlusGlyph);
export const FaRightFromBracket = duotone(SignOut);
export const FaShield = duotone(ShieldGlyph);
export const FaShieldHalved = duotone(ShieldCheckGlyph);
export const FaSpinner = duotone(CircleNotch);
export const FaSquareCheck = duotone(CheckSquare);
export const FaTableColumns = duotone(Columns);
export const FaTicket = duotone(TicketGlyph);
export const FaToggleOff = duotone(ToggleLeft);
export const FaToggleOn = duotone(ToggleRight);
export const FaTrash = duotone(Trash);
export const FaTriangleExclamation = duotone(Warning);
export const FaUser = duotone(UserGlyph);
export const FaUserPlus = duotone(UserPlus);
export const FaUsers = duotone(UsersGlyph);
export const FaWifi = duotone(WifiHigh);
export const FaWpforms = duotone(Textbox);
export const FaXmark = duotone(XGlyph);

// Semantic names for new code.
export const MagnifyingGlassIcon = duotone(MagnifyingGlass);
export const TicketIcon = duotone(TicketGlyph);

// Compatibility names used by migrated route modules. They remain inside the
// shared Phosphor boundary so routes never import a vendor icon package.
export const Plus = FaPlus;
export const Filter = FaFilter;
export const MoreVertical = FaEllipsisVertical;
export const AlertCircle = FaCircleExclamation;
export const X = FaXmark;
export const ChevronLeft = FaChevronLeft;
export const ChevronRight = FaChevronRight;
export const Search = FaMagnifyingGlass;
export const LayoutList = FaList;
export const CopyIcon = FaCopy;
export const CheckIcon = FaCheck;
export const Copy = FaCopy;
export const Check = FaCheck;
export const ArrowLeft = FaArrowLeft;
export const Send = FaPaperPlane;
export const User = FaUser;
export const ShieldCheck = FaShieldHalved;
export const MessageSquare = FaMessage;
export const Mail = FaEnvelope;
export const Activity = FaChartLine;
export const Paperclip = FaPaperclip;
export const ClockIcon = FaClock;
export const Clock = FaClock;
export const Settings = FaGear;
export const Table2 = FaTableColumns;
export const LayoutDashboard = FaChartLine;
export const Ticket = FaTicket;
export const Users = FaUsers;
export const Key = FaKey;
export const LogOut = FaRightFromBracket;
export const Book = FaBook;
export const Menu = FaBars;
export const WifiOff = FaWifi;
export const Bell = FaBell;
export const ChevronDown = FaChevronDown;
export const RefreshCw = FaArrowsRotate;
export const Eye = FaEye;
export const Info = FaCircleInfo;
export const Shield = FaShield;
export const Calendar = FaCalendar;
