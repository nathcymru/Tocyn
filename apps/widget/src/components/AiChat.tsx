import { TocynButton, TocynInput } from '@luminatick/ui/primitives';
import { BASE_URL, widgetHeaders } from '../api';
import React, { useState, useRef, useEffect } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface Props {
  config: any;
}

const AiChat: React.FC<Props> = ({ config }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: config.welcomeMessage || "Hello! I'm here to help you. What's on your mind?",
      timestamp: new Date()
    }
  ]);
  const [history, setHistory] = useState<{ role: 'user' | 'assistant', content: string }[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'auto', block: 'nearest' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (error && !isLoading) inputRef.current?.focus();
  }, [error, isLoading]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending.current) return;
    sending.current = true;
    setError(null);
    const submitted = input;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: submitted,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch(`${BASE_URL}/chat`, {
        method: 'POST',
        headers: widgetHeaders(),
        credentials: 'omit',
        body: JSON.stringify({ message: submitted, history }),
      });

      if (!response.ok) throw new Error('Failed to get response');
      const data = await response.json();
      if (typeof data.response !== 'string') throw new Error('Invalid chat response');

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
      setHistory(prev => [
        ...prev,
        { role: 'user', content: submitted },
        { role: 'assistant', content: data.response }
      ]);
    } catch {
      setMessages(prev => prev.filter(message => message.id !== userMessage.id));
      setInput(submitted);
      setError('A response could not be confirmed. Your question has been kept. You can retry or submit a ticket.');
    } finally {
      sending.current = false;
      setIsLoading(false);
    }
  };

  return (
    <div className="tocyn-widget-ai-chat">
      <div role="log" aria-label="AI conversation" aria-relevant="additions" className="tocyn-widget-ai-messages">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`tocyn-widget-ai-message-row ${msg.role === 'user' ? 'tocyn-widget-ai-message-row--user' : ''}`}
          >
            <div
              className={`tocyn-widget-ai-message ${
                msg.role === 'user'
                  ? 'tocyn-widget-ai-message--user'
                  : 'tocyn-widget-ai-message--assistant'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div role="status" aria-label="Waiting for AI response" className="tocyn-widget-ai-waiting">
            <div className="tocyn-widget-ai-waiting-bubble">
              <div aria-hidden="true" className="tocyn-widget-ai-dots">
                <div className="tocyn-widget-ai-dot" style={{ animationDelay: '0ms' }}></div>
                <div className="tocyn-widget-ai-dot" style={{ animationDelay: '150ms' }}></div>
                <div className="tocyn-widget-ai-dot" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && <p role="alert" className="tocyn-widget-ai-error">{error}</p>}
      <form onSubmit={handleSend} aria-label="Ask AI support" aria-busy={isLoading} className="tocyn-widget-ai-composer">
        <TocynInput
          ref={inputRef}
          aria-label="Your question"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your question..."
          className="tocyn-form-control tocyn-widget-chat-input"
          disabled={isLoading}
        />
        <TocynButton
          aria-label="Send question"
          type="submit"
          disabled={isLoading || !input.trim()}
          className="tocyn-widget-ai-send"
          style={{ backgroundColor: config.primaryColor }}
        >
          <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="tocyn-widget-ai-send-icon" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
          </svg>
        </TocynButton>
      </form>
    </div>
  );
};

export default AiChat;
