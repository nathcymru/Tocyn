import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SecurityProfilePage } from '../pages/SecurityProfilePage';
import { useAuthStore } from '../store/authStore';
import { AuthQueryBoundary } from '../components/auth/AuthQueryBoundary';
import { dashboardApi } from '../api/client';
vi.mock('../api/client',()=>({dashboardApi:{post:vi.fn()}}));
vi.mock('qrcode.react',()=>({QRCodeSVG:({role, 'aria-label': label}:{role?:string;'aria-label'?:string})=> <span role={role} aria-label={label}>Local setup QR</span>}));
const user={id:'synthetic-user',tenant_id:'synthetic-tenant',email:'operator@example.invalid',full_name:'Synthetic operator',role:'agent',mfa_enabled:false};
const setup={provisioning_uri:'otpauth://totp/Synthetic?secret=SYNTHETIC_ONLY'};
beforeEach(()=>{
  useAuthStore.getState().setAuth('synthetic-old-session',user);
  vi.spyOn(HTMLElement.prototype,'getClientRects').mockImplementation(function(this:HTMLElement){return (this.isConnected&&!this.closest('[hidden]')?[new DOMRect(0,0,100,44)]:[]) as unknown as DOMRectList;});
});
afterEach(()=>{cleanup();useAuthStore.getState().logout();vi.restoreAllMocks();vi.clearAllMocks();});
it('guards setup and confirmation, focuses code and adopts the replacement server session only after confirmation',async()=>{
  let finish!:(value:unknown)=>void;vi.mocked(dashboardApi.post).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  render(<SecurityProfilePage/>);const start=screen.getByRole('button',{name:'Set up 2FA'});fireEvent.click(start);fireEvent.click(start);
  expect(dashboardApi.post).toHaveBeenCalledTimes(1);await act(async()=>finish(setup));
  expect(screen.getByRole('img',{name:'Authenticator setup QR code; a text key follows'})).toBeInTheDocument();
  const code=await screen.findByRole('textbox',{name:'Authentication Code'});await waitFor(()=>expect(code).toHaveFocus());
  const cells=screen.getAllByRole('textbox',{name:/Authentication Code/});expect(cells).toHaveLength(6);
  expect(code).toHaveClass('pin-input__input--size_xs');
  expect(code).toHaveAttribute('autocomplete','one-time-code');
  await userEvent.type(code,'123456');
  vi.mocked(dashboardApi.post).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const form=screen.getByRole('form',{name:'Verify two-factor setup'});fireEvent.submit(form);fireEvent.submit(form);
  expect(dashboardApi.post).toHaveBeenCalledTimes(2);expect(cells.every(cell=>(cell as HTMLInputElement).disabled)).toBe(true);
  expect(cells.map(cell=>(cell as HTMLInputElement).value).join('')).toBe('123456');
  await act(async()=>finish({token:'synthetic-replacement-session',user:{...user,mfa_enabled:true}}));
  expect(useAuthStore.getState().token).toBe('synthetic-replacement-session');expect(useAuthStore.getState().user?.mfa_enabled).toBe(true);
  expect(screen.getByRole('status')).toHaveTextContent('successfully enabled');expect(screen.queryByText('SYNTHETIC_ONLY')).not.toBeInTheDocument();
  await waitFor(()=>expect(screen.getByRole('heading',{name:'Security Profile'})).toHaveFocus());
});
it('keeps the replacement-session confirmation announcement through the authentication cache reset',async()=>{
  vi.mocked(dashboardApi.post).mockResolvedValueOnce(setup).mockResolvedValueOnce({token:'synthetic-replacement-session',user:{...user,mfa_enabled:true}});
  render(<AuthQueryBoundary><SecurityProfilePage/></AuthQueryBoundary>);
  fireEvent.click(screen.getByRole('button',{name:'Set up 2FA'}));
  await userEvent.type(await screen.findByRole('textbox',{name:'Authentication Code'}),'123456');
  fireEvent.submit(screen.getByRole('form',{name:'Verify two-factor setup'}));
  expect(await screen.findByRole('status')).toHaveTextContent('successfully enabled');
  await waitFor(()=>expect(screen.getByRole('heading',{name:'Security Profile'})).toHaveFocus());
  expect(useAuthStore.getState().sessionAnnouncement).toBeNull();
});

it('retains failed confirmation for retry and clears local setup material on cancellation',async()=>{
  vi.mocked(dashboardApi.post).mockResolvedValueOnce(setup).mockRejectedValueOnce(new Error('private server detail'));
  render(<SecurityProfilePage/>);fireEvent.click(screen.getByRole('button',{name:'Set up 2FA'}));
  const code=await screen.findByRole('textbox',{name:'Authentication Code'});await userEvent.type(code,'123456');
  fireEvent.submit(screen.getByRole('form',{name:'Verify two-factor setup'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed');
  expect(screen.getAllByRole('textbox',{name:/Authentication Code/}).map(cell=>(cell as HTMLInputElement).value).join('')).toBe('123456');
  expect(code).toHaveAttribute('aria-invalid','true');
  expect(useAuthStore.getState().token).toBe('synthetic-old-session');expect(useAuthStore.getState().user?.mfa_enabled).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(screen.queryByText('SYNTHETIC_ONLY')).not.toBeInTheDocument();
  await waitFor(()=>expect(screen.getByRole('button',{name:'Set up 2FA'})).toHaveFocus());
});
it('accepts pasted codes with separators and keeps six labelled Park cells',async()=>{
  vi.mocked(dashboardApi.post).mockResolvedValueOnce(setup);
  render(<SecurityProfilePage/>);fireEvent.click(screen.getByRole('button',{name:'Set up 2FA'}));
  const cells=await screen.findAllByRole('textbox',{name:/Authentication Code/});
  expect(cells).toHaveLength(6);
  fireEvent.submit(screen.getByRole('form',{name:'Verify two-factor setup'}));
  expect(screen.getByRole('alert')).toHaveTextContent('Please enter a valid 6-digit code');
  expect(dashboardApi.post).toHaveBeenCalledTimes(1);
  fireEvent.paste(cells[0],{clipboardData:{getData:()=> '12-34 56'}});
  await waitFor(()=>expect(cells.map(cell=>(cell as HTMLInputElement).value).join('')).toBe('123456'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(cells.every(cell=>cell.getAttribute('aria-invalid') !== 'true')).toBe(true);
  expect(screen.getByRole('button',{name:'Verify & Enable'})).toBeEnabled();
});
it('ignores setup response after the authenticated session changes',async()=>{
  let finish!:(value:unknown)=>void;vi.mocked(dashboardApi.post).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  render(<SecurityProfilePage/>);fireEvent.click(screen.getByRole('button',{name:'Set up 2FA'}));
  act(()=>useAuthStore.getState().setAuth('different-session',{...user,id:'different-user'}));
  await act(async()=>finish(setup));expect(screen.queryByText('SYNTHETIC_ONLY')).not.toBeInTheDocument();expect(useAuthStore.getState().token).toBe('different-session');
});
it.each(['agent','admin'])('does not expose disabling mandatory MFA for %s',role=>{
  useAuthStore.getState().setAuth('synthetic-session',{...user,role,mfa_enabled:true});render(<SecurityProfilePage/>);
  expect(screen.queryByRole('button',{name:'Disable 2FA'})).not.toBeInTheDocument();expect(screen.getByText(/mandatory for your role/)).toBeInTheDocument();expect(dashboardApi.post).not.toHaveBeenCalled();
});
it('uses Park dialog anatomy and returns focus to the disable trigger after idle Escape',async()=>{
  useAuthStore.getState().setAuth('synthetic-session',{...user,role:'customer',mfa_enabled:true});
  render(<SecurityProfilePage/>);
  const trigger=screen.getByRole('button',{name:'Disable 2FA'});
  trigger.focus();fireEvent.click(trigger);
  const dialog=await screen.findByRole('dialog',{name:'Disable two-factor authentication?'});
  expect(dialog).toHaveClass('dialog__content');
  expect(dialog).toHaveAccessibleDescription('This will make your account less secure and sign you out. You will need to sign in again.');
  expect(document.querySelector('.dialog__backdrop')).toBeInTheDocument();
  expect(dialog.querySelector('.dialog__header .dialog__title')).toHaveTextContent('Disable two-factor authentication?');
  expect(dialog.querySelector('.dialog__body .dialog__description')).toHaveTextContent('sign you out');
  expect(dialog.querySelector('.dialog__footer')).toContainElement(within(dialog).getByRole('button',{name:'Cancel'}));
  await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Cancel'})).toHaveFocus());
  fireEvent.pointerDown(document.body);fireEvent.click(document.body);
  expect(dialog).toBeInTheDocument();
  fireEvent.keyDown(dialog,{key:'Escape'});
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(()=>expect(trigger).toHaveFocus());
  expect(dashboardApi.post).not.toHaveBeenCalled();
});
it('confirms optional disabling with safe focus, blocks pending dismissal and retains enabled state after failure',async()=>{
  useAuthStore.getState().setAuth('synthetic-session',{...user,role:'customer',mfa_enabled:true});
  let reject!:(error:Error)=>void;vi.mocked(dashboardApi.post).mockImplementationOnce(()=>new Promise((_resolve,failure)=>{reject=failure;}));
  render(<SecurityProfilePage/>);const trigger=screen.getByRole('button',{name:'Disable 2FA'});
  expect(trigger).toHaveClass('button', 'button--variant_outline', 'color-palette_red');
  trigger.focus();fireEvent.click(trigger);
  const dialog=await screen.findByRole('dialog',{name:'Disable two-factor authentication?'});
  await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Cancel'})).toHaveFocus());
  fireEvent.click(within(dialog).getByRole('button',{name:'Disable 2FA'}));
  expect(within(dialog).getByRole('button',{name:'Cancel'})).toBeDisabled();
  expect(within(dialog).getByRole('button',{name:'Disable 2FA'})).toBeDisabled();
  fireEvent.keyDown(dialog,{key:'Escape'});
  expect(dialog).toBeInTheDocument();expect(dashboardApi.post).toHaveBeenCalledTimes(1);
  await act(async()=>reject(new Error('synthetic failure')));
  expect(within(dialog).getByRole('alert')).toHaveClass('alert__root');
  expect(within(dialog).getByRole('alert')).toHaveTextContent('remains shown as enabled');expect(useAuthStore.getState().user?.mfa_enabled).toBe(true);
  fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));await waitFor(()=>expect(trigger).toHaveFocus());
});

it('does not adopt a completed confirmation from an obsolete session',async()=>{
  let finish!:(value:unknown)=>void;
  vi.mocked(dashboardApi.post).mockResolvedValueOnce(setup).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  render(<SecurityProfilePage/>);fireEvent.click(screen.getByRole('button',{name:'Set up 2FA'}));
  await userEvent.type(await screen.findByRole('textbox',{name:'Authentication Code'}),'123456');
  fireEvent.submit(screen.getByRole('form',{name:'Verify two-factor setup'}));
  act(()=>useAuthStore.getState().setAuth('new-session',{...user,id:'new-user'}));
  await act(async()=>finish({token:'obsolete-confirmation-token',user:{...user,mfa_enabled:true}}));
  expect(useAuthStore.getState().token).toBe('new-session');expect(useAuthStore.getState().user?.id).toBe('new-user');
  expect(useAuthStore.getState().user?.mfa_enabled).toBe(false);expect(screen.queryByText(/successfully enabled/)).not.toBeInTheDocument();
});

it('clears the revoked local session after optional MFA is successfully disabled',async()=>{
  useAuthStore.getState().setAuth('synthetic-session',{...user,role:'customer',mfa_enabled:true});
  vi.mocked(dashboardApi.post).mockResolvedValueOnce({user:{...user,role:'customer',mfa_enabled:false}});
  render(<SecurityProfilePage/>);fireEvent.click(screen.getByRole('button',{name:'Disable 2FA'}));
  const dialog=await screen.findByRole('dialog',{name:'Disable two-factor authentication?'});
  expect(dialog).toHaveTextContent('sign you out');
  fireEvent.click(within(dialog).getByRole('button',{name:'Disable 2FA'}));
  await waitFor(()=>expect(useAuthStore.getState().token).toBeNull());expect(useAuthStore.getState().user).toBeNull();
});
