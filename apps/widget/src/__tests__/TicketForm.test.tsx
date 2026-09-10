// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TicketForm from '../components/TicketForm';
vi.mock('../api',()=>({BASE_URL:'/local-widget',widgetHeaders:()=>new Headers({'X-Widget-Key':'synthetic-public-key',Authorization:'Bearer synthetic-customer-token'})}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function fill(){render(<TicketForm config={{primaryColor:'#123456'}} userEmail="customer@example.invalid"/>);fireEvent.change(screen.getByRole('textbox',{name:'Your Name'}),{target:{value:'Synthetic customer'}});fireEvent.change(screen.getByRole('textbox',{name:'Subject'}),{target:{value:'Synthetic subject'}});fireEvent.change(screen.getByRole('textbox',{name:'Message'}),{target:{value:'Synthetic message'}});return screen.getByRole('form',{name:'Submit a support ticket'});}
it('keeps labelled authenticated email read-only and guards duplicate submissions with the existing request contract',async()=>{
 let finish!:(response:Response)=>void;const request=vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',request);const form=fill();const email=screen.getByRole('textbox',{name:'Email Address'});expect(email).toHaveAttribute('readonly');expect(email).toHaveValue('customer@example.invalid');
 fireEvent.submit(form);fireEvent.submit(form);expect(request).toHaveBeenCalledTimes(1);expect(screen.getByRole('textbox',{name:'Message'})).toBeDisabled();expect(form).toHaveAttribute('aria-busy','true');expect(screen.getByRole('status')).toHaveTextContent('Submitting');
 const [url,options]=request.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('/local-widget/tickets');expect(options.credentials).toBe('omit');expect(new Headers(options.headers).get('Authorization')).toBe('Bearer synthetic-customer-token');expect(JSON.parse(options.body as string)).toEqual({name:'Synthetic customer',email:'customer@example.invalid',subject:'Synthetic subject',message:'Synthetic message'});
 await act(async()=>finish(new Response('{}',{status:200})));await waitFor(()=>expect(screen.getByRole('heading',{name:'Ticket Submitted!'})).toHaveFocus());
 fireEvent.click(screen.getByRole('button',{name:'Submit another ticket'}));await waitFor(()=>expect(screen.getByRole('textbox',{name:'Your Name'})).toHaveFocus());expect(screen.getByRole('textbox',{name:'Message'})).toHaveValue('');expect(screen.getByRole('textbox',{name:'Email Address'})).toHaveValue('customer@example.invalid');
});
it('preserves failed content, announces the error and supports an explicit retry',async()=>{
 const request=vi.fn().mockResolvedValueOnce(new Response('{}',{status:403})).mockResolvedValueOnce(new Response('{}',{status:200}));vi.stubGlobal('fetch',request);const form=fill();fireEvent.submit(form);
 const error=await screen.findByRole('alert');expect(error).toHaveTextContent('could not be confirmed');await waitFor(()=>expect(error).toHaveFocus());expect(screen.getByRole('textbox',{name:'Message'})).toHaveValue('Synthetic message');expect(screen.getByRole('button',{name:'Send Message'})).toBeEnabled();
 fireEvent.submit(form);await screen.findByRole('heading',{name:'Ticket Submitted!'});expect(request).toHaveBeenCalledTimes(2);
});
