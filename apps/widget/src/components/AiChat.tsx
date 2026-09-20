import { w } from '../widgetStyles';
import { ParkButton, ParkInput } from '@luminatick/ui/park';
import { IconPaperPlane } from '@luminatick/ui/icons';
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
    <div className={w.aiChat}>
      <div role="log" aria-label="AI conversation" aria-relevant="additions" className={w.aiMessages}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={[w.aiMessageRow, msg.role === 'user' ? w.aiMessageRowUser : ''].join(' ')}
          >
            <div
              className={[w.aiMessage, msg.role === 'user' ? w.aiMessageUser : w.aiMessageAssistant].join(' ')}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div role="status" aria-label="Waiting for AI response" className={w.aiWaiting}>
            <div className={w.aiWaitingBubble}>
              <div aria-hidden="true" className={w.aiDots}>
                <div className={w.aiDot}></div>
                <div className={w.aiDot}></div>
                <div className={w.aiDot}></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && <p role="alert" className={w.aiError}>{error}</p>}
      <form onSubmit={handleSend} aria-label="Ask AI support" aria-busy={isLoading} className={w.aiComposer}>
        <ParkInput
          ref={inputRef}
          aria-label="Your question"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your question..."
          className={[w.formControl, w.chatInput].join(' ')}
          disabled={isLoading}
        />
        <ParkButton
          aria-label="Send question"
          type="submit"
          disabled={isLoading || !input.trim()}
          className={w.aiSend}
        >
          <IconPaperPlane className={w.aiSendIcon} aria-hidden="true" />
        </ParkButton>
      </form>
    </div>
  );
};

export default AiChat;
