import React from 'react';
import {
  AlignLeft, ArrowLeft, ArrowRight, ArrowSquareOut, ArrowsClockwise, Bell, BookOpen,
  Buildings, Calendar, ChartBar, ChartLine, Check, CheckCircle, CheckSquare, CircleNotch, ChatCircle, CaretDown, CaretLeft, CaretRight,
  Clock, Cloud, Columns, Copy, Cpu, CreditCard, Database, DotsThreeVertical, Envelope,
  Eye, FileText, FloppyDisk, Folder, Funnel, Gear, HardDrive, Info, Key, Lightning,
  List, ListBullets, MagnifyingGlass, Paperclip, PaperPlaneTilt, PencilSimple, Plus,
  Shield, ShieldCheck, SignOut, TextAlignLeft, TextT, Textbox, Ticket, TreeStructure,
  Trash, Triangle, ToggleLeft, ToggleRight, User, UserPlus, Users, Warning, WarningCircle,
  WifiHigh, X , type IconProps,
} from '@phosphor-icons/react';

/** Shared icon boundary: application icons are duotone and inherit semantic colour. */
function duotone(Icon: React.ComponentType<any>) {
  return React.forwardRef<SVGSVGElement, any>((props, ref) => (
    <Icon {...props} ref={ref} weight="duotone" aria-hidden={props['aria-label'] ? undefined : true} />
  ));
}

export type TocynIconProps = IconProps;
export const FaAlignLeft = duotone(AlignLeft);
export const FaArrowLeft = duotone(ArrowLeft);
export const FaArrowRight = duotone(ArrowRight);
export const FaArrowUpRightFromSquare = duotone(ArrowSquareOut);
export const FaArrowRightFromBracket = duotone(SignOut);
export const FaArrowsRotate = duotone(ArrowsClockwise);
export const FaBars = duotone(List);
export const FaBell = duotone(Bell);
export const FaBolt = duotone(Lightning);
export const FaBook = duotone(BookOpen);
export const FaBuilding = duotone(Buildings);
export const FaCalendar = duotone(Calendar);
export const FaChartBar = duotone(ChartBar);
export const FaChartLine = duotone(ChartLine);
export const FaCheck = duotone(Check);
export const FaChevronDown = duotone(CaretDown);
export const FaChevronLeft = duotone(CaretLeft);
export const FaChevronRight = duotone(CaretRight);
export const FaCircleCheck = duotone(CheckCircle);
export const FaCircleExclamation = duotone(WarningCircle);
export const FaCircleInfo = duotone(Info);
export const FaClock = duotone(Clock);
export const FaCloud = duotone(Cloud);
export const FaCopy = duotone(Copy);
export const FaCreditCard = duotone(CreditCard);
export const FaDatabase = duotone(Database);
export const FaDiagramProject = duotone(TreeStructure);
export const FaEllipsisVertical = duotone(DotsThreeVertical);
export const FaEnvelope = duotone(Envelope);
export const FaEye = duotone(Eye);
export const FaFileLines = duotone(FileText);
export const FaFilter = duotone(Funnel);
export const FaFloppyDisk = duotone(FloppyDisk);
export const FaFolder = duotone(Folder);
export const FaFont = duotone(TextT);
export const FaGear = duotone(Gear);
export const FaHardDrive = duotone(HardDrive);
export const FaKey = duotone(Key);
export const FaList = duotone(ListBullets);
export const FaMagnifyingGlass = duotone(MagnifyingGlass);
export const FaMessage = duotone(ChatCircle);
export const FaMicrochip = duotone(Cpu);
export const FaPaperPlane = duotone(PaperPlaneTilt);
export const FaPaperclip = duotone(Paperclip);
export const FaPenToSquare = duotone(PencilSimple);
export const FaPlus = duotone(Plus);
export const FaRightFromBracket = duotone(SignOut);
export const FaShield = duotone(Shield);
export const FaShieldHalved = duotone(ShieldCheck);
export const FaSpinner = duotone(CircleNotch);
export const FaSquareCheck = duotone(CheckSquare);
export const FaTableColumns = duotone(Columns);
export const FaTicket = duotone(Ticket);
export const FaToggleOff = duotone(ToggleLeft);
export const FaToggleOn = duotone(ToggleRight);
export const FaTrash = duotone(Trash);
export const FaTriangleExclamation = duotone(Warning);
export const FaUser = duotone(User);
export const FaUserPlus = duotone(UserPlus);
export const FaUsers = duotone(Users);
export const FaWifi = duotone(WifiHigh);
export const FaWpforms = duotone(Textbox);
export const FaXmark = duotone(X);

// Semantic names for new code.
export const MagnifyingGlassIcon = duotone(MagnifyingGlass);
export const TicketIcon = duotone(Ticket);
