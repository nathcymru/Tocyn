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
    <div className="flex flex-col h-[400px]">
      <div role="log" aria-label="AI conversation" aria-relevant="additions" className="flex-1 overflow-y-auto space-y-4 mb-4 pr-1 scrollbar-thin scrollbar-thumb-gray-200">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] px-3 py-2 rounded-lg text-sm break-words whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-none'
                  : 'bg-gray-100 text-gray-800 rounded-bl-none'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div role="status" aria-label="Waiting for AI response" className="flex justify-start">
            <div className="bg-gray-100 px-3 py-2 rounded-lg rounded-bl-none">
              <div aria-hidden="true" className="flex space-x-1">
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full" style={{ animationDelay: '0ms' }}></div>
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full" style={{ animationDelay: '150ms' }}></div>
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && <p role="alert" className="text-red-700 text-sm mb-2">{error}</p>}
      <form onSubmit={handleSend} aria-label="Ask AI support" aria-busy={isLoading} className="flex gap-2">
        <TocynInput
          ref={inputRef}
          aria-label="Your question"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your question..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm"
          disabled={isLoading}
        />
        <TocynButton
          aria-label="Send question"
          type="submit"
          disabled={isLoading || !input.trim()}
          className="p-2 rounded text-white flex items-center justify-center disabled:opacity-50 transition-colors"
          style={{ backgroundColor: config.primaryColor }}
        >
          <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
          </svg>
        </TocynButton>
      </form>
    </div>
  );
};

export default AiChat;
