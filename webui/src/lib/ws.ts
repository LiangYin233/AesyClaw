import { ref, onUnmounted } from 'vue';
import { getAuthToken } from './api';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001/ws';

export interface WSMessage {
  type: string;
  [key: string]: unknown;
}

export function useWebSocket() {
  const ws = ref<WebSocket | null>(null);
  const connected = ref(false);
  const error = ref<string | null>(null);
  const reconnectAttempts = ref(0);
  const maxReconnectAttempts = 5;
  const reconnectDelay = 3000;

  let messageHandler: ((msg: WSMessage) => void) | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  function connect(onMessage?: (msg: WSMessage) => void): void {
    messageHandler = onMessage || null;

    const token = getAuthToken();
    if (!token) {
      error.value = 'No authentication token';
      return;
    }

    const url = `${WS_URL}?token=${token}`;
    ws.value = new WebSocket(url);

    ws.value.onopen = () => {
      connected.value = true;
      error.value = null;
      reconnectAttempts.value = 0;
      console.log('WebSocket connected');
    };

    ws.value.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);
        if (messageHandler) {
          messageHandler(msg);
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    ws.value.onerror = (event) => {
      console.error('WebSocket error:', event);
      error.value = 'WebSocket connection error';
    };

    ws.value.onclose = (event) => {
      connected.value = false;
      console.log('WebSocket closed:', event.code, event.reason);

      if (event.code !== 1000 && reconnectAttempts.value < maxReconnectAttempts) {
        reconnectAttempts.value++;
        console.log(`Reconnecting... attempt ${reconnectAttempts.value}`);
        reconnectTimeout = setTimeout(() => connect(messageHandler!), reconnectDelay);
      }
    };
  }

  function disconnect(): void {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    if (ws.value) {
      ws.value.close(1000, 'Client disconnect');
      ws.value = null;
    }

    connected.value = false;
  }

  function send(message: WSMessage): void {
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify(message));
    } else {
      console.error('WebSocket is not connected');
    }
  }

  function sendChatMessage(chatId: string, text: string): void {
    send({
      type: 'chat_message',
      chatId,
      text,
    });
  }

  onUnmounted(() => {
    disconnect();
  });

  return {
    ws,
    connected,
    error,
    reconnectAttempts,
    connect,
    disconnect,
    send,
    sendChatMessage,
  };
}
