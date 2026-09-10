import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UsersPage } from '../pages/UsersPage';
vi.mock('../hooks/useUsers',()=>({useUsers:()=>({isLoading:false,error:null,data:[{id:'synthetic-user',full_name:'Synthetic operator',email:'operator@example.invalid',role:'agent',mfa_enabled:true,created_at:'2026-09-10T00:00:00Z'}]})}));
beforeEach(()=>{
  // Layout-only shim: Ark owns actual focus, Escape and dismissal behavior.
  vi.spyOn(HTMLElement.prototype,'getClientRects').mockImplementation(function(this:HTMLElement){return (this.isConnected && !this.closest('[hidden]')?[new DOMRect(0,0,100,44)]:[]) as unknown as DOMRectList;});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it.each([['Edit Profile','Edit User Profile'],['View Activity','User Activity Log']])('opens %s with a named modal and returns focus on Escape',async(triggerName,title)=>{
  render(<UsersPage/>);
  const opener=screen.getByRole('button',{name:triggerName});opener.focus();fireEvent.click(opener);
  const dialog=await screen.findByRole('dialog',{name:title});
  expect(dialog).toHaveAttribute('aria-modal','true');
  await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Close user details'})).toHaveFocus());
  fireEvent.keyDown(document.activeElement!,{key:'Escape'});
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(()=>expect(opener).toHaveFocus());
});
it('does not present fabricated activity as evidence and supports the explicit close control',async()=>{
  render(<UsersPage/>);const opener=screen.getByRole('button',{name:'View Activity'});opener.focus();fireEvent.click(opener);
  const dialog=await screen.findByRole('dialog',{name:'User Activity Log'});
  expect(dialog).toHaveTextContent('No activity records have been loaded');
  expect(dialog).not.toHaveTextContent('192.168.1.45');expect(dialog).not.toHaveTextContent('Resolved Ticket');
  fireEvent.click(within(dialog).getByRole('button',{name:'Close'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(()=>expect(opener).toHaveFocus());
});
