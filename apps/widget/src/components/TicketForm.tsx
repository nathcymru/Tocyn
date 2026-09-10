import { TocynButton, TocynInput, TocynTextarea } from '@luminatick/ui/primitives';
import { BASE_URL, widgetHeaders } from '../api';
import React, { useState } from 'react';

interface Props {
  config: any;
  userEmail: string;
}

const TicketForm: React.FC<Props> = ({ config, userEmail }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: userEmail,
    subject: '',
    message: ''
  });
  const formId = React.useId();
  const submitting = React.useRef(false);
  const nameInput = React.useRef<HTMLInputElement>(null);
  const successHeading = React.useRef<HTMLHeadingElement>(null);
  const errorMessage = React.useRef<HTMLParagraphElement>(null);
  const focusNewDraft = React.useRef(false);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

  React.useEffect(() => {
    if (status === 'success') successHeading.current?.focus();
    if (status === 'error') errorMessage.current?.focus();
    if (status === 'idle' && focusNewDraft.current) { focusNewDraft.current = false; nameInput.current?.focus(); }
  }, [status]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setStatus('submitting');

    try {
      const response = await fetch(`${BASE_URL}/tickets`, {
        method: 'POST',
        headers: widgetHeaders(),
        credentials: 'omit',
        body: JSON.stringify(formData),
      });

      if (!response.ok) throw new Error('Failed to submit');

      setStatus('success');
      setFormData({ name: '', email: userEmail, subject: '', message: '' });
    } catch {
      setStatus('error');
    } finally { submitting.current = false; }
  };

  if (status === 'success') {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 ref={successHeading} tabIndex={-1} className="text-lg font-bold text-gray-900 mb-2">Ticket Submitted!</h3>
        <p role="status" className="text-gray-600 mb-6">We've received your request and will get back to you soon.</p>
        <TocynButton
          onClick={() => { focusNewDraft.current = true; setStatus('idle'); }}
          className="text-blue-600 font-medium hover:underline"
        >
          Submit another ticket
        </TocynButton>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Submit a support ticket" aria-busy={status === 'submitting'} className="space-y-4">
      <fieldset disabled={status === 'submitting'} className="space-y-4">
      <div>
        <label htmlFor={`${formId}-name`} className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Your Name</label>
        <TocynInput
          type="text"
          required
          className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          placeholder="John Doe"
          id={`${formId}-name`} ref={nameInput} value={formData.name}
          onChange={e => setFormData({ ...formData, name: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor={`${formId}-email`} className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Email Address</label>
        <TocynInput
          type="email"
          required
          className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          placeholder="john@example.com"
          id={`${formId}-email`} value={formData.email}
          readOnly
        />
      </div>
      <div>
        <label htmlFor={`${formId}-subject`} className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Subject</label>
        <TocynInput
          type="text"
          required
          className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          placeholder="How can we help?"
          id={`${formId}-subject`} value={formData.subject}
          onChange={e => setFormData({ ...formData, subject: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor={`${formId}-message`} className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Message</label>
        <TocynTextarea
          required
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 resize-none"
          placeholder="Tell us more about your issue..."
          id={`${formId}-message`} value={formData.message}
          onChange={e => setFormData({ ...formData, message: e.target.value })}
        />
      </div>
      </fieldset>
      {status === 'submitting' && <p role="status">Submitting your ticket...</p>}
      {status === 'error' && (
        <p ref={errorMessage} tabIndex={-1} role="alert" className="text-red-700 text-sm">Submission could not be confirmed. Your message has been kept; try again.</p>
      )}
      <TocynButton
        type="submit"
        disabled={status === 'submitting'}
        className="w-full py-2 px-4 rounded font-bold text-white transition-opacity disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        style={{ backgroundColor: config.primaryColor }}
      >
        {status === 'submitting' ? 'Submitting...' : 'Send Message'}
      </TocynButton>
    </form>
  );
};

export default TicketForm;
