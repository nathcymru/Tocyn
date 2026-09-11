import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';

export interface RealtimeMessage {
  type: string;
  payload: any;
}

export interface RealtimePresence {
  connectionId: string;
  userId: string;
  name: string;
  location: string | null;
}

export interface RealtimeConnection {
  isConnected: boolean;
  lastMessage: RealtimeMessage | null;
  presence: RealtimePresence[];
  updateLocation: (location: string | null) => void;
  connectionDetails: { latency: number; reconnectCount: number };
  /** Optional during test doubles; the provider safely treats absence as offline. */
  sendRealtime?: (message: RealtimeMessage) => boolean;
  manualReconnect: () => void;
}

export function useRealtime(): RealtimeConnection {
  const { token } = useAuthStore();
  
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<RealtimeMessage | null>(null);
  const [presence, setPresence] = useState<RealtimePresence[]>([]);
  const [connectionDetails, setConnectionDetails] = useState<{
    latency: number;
    reconnectCount: number;
  }>({ latency: 0, reconnectCount: 0 });

  const locationRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // WebSocket Transport
  useEffect(() => {
    if (!token) return;

    let reconnectTimer: number;
    let ws: WebSocket | null = null;
    let reconnectAttempts = 0;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const baseUrl = import.meta.env.VITE_API_URL 
        ? new URL(import.meta.env.VITE_API_URL).host
        : window.location.host;
        
      ws = new WebSocket(`${protocol}//${baseUrl}/api/realtime?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttempts = 0; // Reset attempts on successful connection
        if (locationRef.current) {
          ws?.send(JSON.stringify({
            type: 'presence.update',
            payload: { location: locationRef.current }
          }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'presence.sync') {
            if (Array.isArray(data.payload)) setPresence(data.payload as RealtimePresence[]);
          } else if (data.type === 'presence.update') {
            setPresence(prev => {
              if (data.payload.status === 'offline') {
                return prev.filter(p => p.connectionId !== data.payload.connectionId);
              }
              const exists = prev.find(p => p.connectionId === data.payload.connectionId);
              if (exists) {
                return prev.map(p => p.connectionId === data.payload.connectionId ? data.payload : p);
              }
              return [...prev, data.payload];
            });
          } else {
            setLastMessage(data);
          }
        } catch (e) {
          console.error('WebSocket parse error:', e);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        setConnectionDetails(prev => ({ ...prev, reconnectCount: prev.reconnectCount + 1 }));
        
        const baseDelay = 1000;
        const maxDelay = 30000;
        const delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts), maxDelay);
        reconnectAttempts++;
        
        reconnectTimer = window.setTimeout(connect, delay);
      };
      
      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        ws?.close();
      };
    };

    connect();

    return () => {
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      window.clearTimeout(reconnectTimer);
      wsRef.current = null;
      setIsConnected(false);
    };
  }, [token]);

  const updateLocation = useCallback((location: string | null) => {
    locationRef.current = location;
    
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'presence.update',
        payload: { location }
      }));
    }
  }, []);

  const sendRealtime = useCallback((message: RealtimeMessage) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return false;
    wsRef.current.send(JSON.stringify(message));
    return true;
  }, []);

  const manualReconnect = useCallback(() => {
    if (wsRef.current) wsRef.current.close(); // Triggers reconnect
  }, []);

  return { 
    isConnected, 
    lastMessage, 
    presence, 
    updateLocation, 
    connectionDetails,
    sendRealtime,
    manualReconnect 
  };
}
