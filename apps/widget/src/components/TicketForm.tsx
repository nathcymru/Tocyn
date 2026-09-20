import { w } from '../widgetStyles';
import { ParkAlert, ParkButton, ParkField, ParkInput, ParkProgress, ParkTextarea } from '@luminatick/ui/park';
import { IconCircleCheck } from '@luminatick/ui/icons';
import { BASE_URL, widgetHeaders } from '../api';
import React, { useState } from 'react';

interface Props {
  config?: unknown;
  userEmail: string;
}

const TicketForm: React.FC<Props> = ({ userEmail }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: userEmail,
    subject: '',
    message: ''
  });
  const submitting = React.useRef(false);
  const nameInput = React.useRef<HTMLInputElement>(null);
  const successHeading = React.useRef<HTMLHeadingElement>(null);
  const errorMessage = React.useRef<HTMLDivElement>(null);
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
      <div className={w.success}>
        <div className={w.successIcon}>
          <IconCircleCheck className={w.successMark} aria-hidden="true" />
        </div>
        <h3 ref={successHeading} tabIndex={-1} className={w.successTitle}>Ticket Submitted!</h3>
        <p role="status" className={w.successCopy}>We've received your request and will get back to you soon.</p>
        <ParkButton
          onClick={() => { focusNewDraft.current = true; setStatus('idle'); }}
          variant="outline"
          className={w.successAction}
        >
          Submit another ticket
        </ParkButton>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Submit a support ticket" aria-busy={status === 'submitting'} className={w.form}>
      <fieldset disabled={status === 'submitting'} className={w.form}>
      <ParkField label="Your Name">
        <ParkInput
          type="text"
          required
          className={w.formControl}
          placeholder="John Doe"
          ref={nameInput} value={formData.name}
          onChange={e => setFormData({ ...formData, name: e.target.value })}
        />
      </ParkField>
      <ParkField label="Email Address">
        <ParkInput
          type="email"
          required
          className={w.formControl}
          placeholder="john@example.com"
          value={formData.email}
          readOnly
        />
      </ParkField>
      <ParkField label="Subject">
        <ParkInput
          type="text"
          required
          className={w.formControl}
          placeholder="How can we help?"
          value={formData.subject}
          onChange={e => setFormData({ ...formData, subject: e.target.value })}
        />
      </ParkField>
      <ParkField label="Message">
        <ParkTextarea
          required
          rows={3}
          className={[w.formControl, w.textarea].join(' ')}
          placeholder="Tell us more about your issue..."
          value={formData.message}
          onChange={e => setFormData({ ...formData, message: e.target.value })}
        />
      </ParkField>
      </fieldset>
      {status === 'submitting' && <div role="status"><ParkProgress value={null} label="Submitting your ticket…" /></div>}
      {status === 'error' && (
        <ParkAlert.Root ref={errorMessage} tabIndex={-1} role="alert" status="error" variant="surface">
          <ParkAlert.Content><ParkAlert.Description>Submission could not be confirmed. Your message has been kept; try again.</ParkAlert.Description></ParkAlert.Content>
        </ParkAlert.Root>
      )}
      <ParkButton
        type="submit"
        disabled={status === 'submitting'}
        variant="solid"
        className={w.submit}
      >
        {status === 'submitting' ? 'Submitting...' : 'Send Message'}
      </ParkButton>
    </form>
  );
};

export default TicketForm;
