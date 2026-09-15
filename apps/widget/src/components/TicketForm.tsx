import { ParkButton, ParkInput, ParkTextarea } from '@luminatick/ui/park';
import { IconCircleCheck } from '@luminatick/ui/icons';
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
      <div className="tocyn-widget-success">
        <div className="tocyn-widget-success-icon">
          <IconCircleCheck className="tocyn-widget-success-mark" aria-hidden="true" />
        </div>
        <h3 ref={successHeading} tabIndex={-1} className="tocyn-widget-success-title">Ticket Submitted!</h3>
        <p role="status" className="tocyn-widget-success-copy">We've received your request and will get back to you soon.</p>
        <ParkButton
          onClick={() => { focusNewDraft.current = true; setStatus('idle'); }}
          className="tocyn-widget-success-action"
        >
          Submit another ticket
        </ParkButton>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Submit a support ticket" aria-busy={status === 'submitting'} className="tocyn-widget-form">
      <fieldset disabled={status === 'submitting'} className="tocyn-widget-form">
      <div>
        <label htmlFor={`${formId}-name`} className="tocyn-widget-label">Your Name</label>
        <ParkInput
          type="text"
          required
          className="tocyn-form-control"
          placeholder="John Doe"
          id={`${formId}-name`} ref={nameInput} value={formData.name}
          onChange={e => setFormData({ ...formData, name: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor={`${formId}-email`} className="tocyn-widget-label">Email Address</label>
        <ParkInput
          type="email"
          required
          className="tocyn-form-control"
          placeholder="john@example.com"
          id={`${formId}-email`} value={formData.email}
          readOnly
        />
      </div>
      <div>
        <label htmlFor={`${formId}-subject`} className="tocyn-widget-label">Subject</label>
        <ParkInput
          type="text"
          required
          className="tocyn-form-control"
          placeholder="How can we help?"
          id={`${formId}-subject`} value={formData.subject}
          onChange={e => setFormData({ ...formData, subject: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor={`${formId}-message`} className="tocyn-widget-label">Message</label>
        <ParkTextarea
          required
          rows={3}
          className="tocyn-form-control tocyn-widget-textarea"
          placeholder="Tell us more about your issue..."
          id={`${formId}-message`} value={formData.message}
          onChange={e => setFormData({ ...formData, message: e.target.value })}
        />
      </div>
      </fieldset>
      {status === 'submitting' && <p role="status">Submitting your ticket...</p>}
      {status === 'error' && (
        <p ref={errorMessage} tabIndex={-1} role="alert" className="tocyn-widget-error">Submission could not be confirmed. Your message has been kept; try again.</p>
      )}
      <ParkButton
        type="submit"
        disabled={status === 'submitting'}
        className="tocyn-widget-submit"
        style={{ backgroundColor: config.primaryColor }}
      >
        {status === 'submitting' ? 'Submitting...' : 'Send Message'}
      </ParkButton>
    </form>
  );
};

export default TicketForm;
