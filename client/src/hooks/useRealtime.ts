/**
 * React Hooks for Real-Time Updates
 * WebSocket subscription management with automatic cleanup
 */

import { useEffect, useRef, useState, useCallback } from "react";

interface RealtimeMessage {
  type: string;
  channel?: string;
  event?: { type: string; data: unknown };
  clientId?: string;
  error?: string;
  timestamp: string;
}

/**
 * Low-level WebSocket hook
 * Handles connection, message parsing, and cleanup
 */
export function useWebSocket(token: string | null) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!token) {
      setConnected(false);
      return;
    }

    const connect = () => {
      try {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}?token=${encodeURIComponent(token)}`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log("[WS] Connected");
          setConnected(true);
          if (reconnectRef.current) {
            clearTimeout(reconnectRef.current);
            reconnectRef.current = null;
          }
        };

        ws.onerror = (error) => {
          console.error("[WS] Error:", error);
          setConnected(false);
        };

        ws.onclose = () => {
          console.log("[WS] Disconnected");
          setConnected(false);
          // Auto-reconnect after 3 seconds
          reconnectRef.current = setTimeout(connect, 3000);
        };

        wsRef.current = ws;
      } catch (error) {
        console.error("[WS] Connection failed:", error);
        setConnected(false);
      }
    };

    connect();

    return () => {
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [token]);

  return { connected, ws: wsRef.current };
}

/**
 * Subscribe to a real-time channel
 * Usage:
 *   const { data, connected } = useSubscription("fleet-status:orgId", token);
 */
export function useSubscription(channel: string, token: string | null) {
  const { connected, ws } = useWebSocket(token);
  const [data, setData] = useState<any>(null);
  const [subscribed, setSubscribed] = useState(false);

  // Subscribe when connected
  useEffect(() => {
    if (!connected || !ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data) as RealtimeMessage;

        if (message.type === "SUBSCRIBED" && message.channel === channel) {
          setSubscribed(true);
        } else if (message.type === "MESSAGE" && message.channel === channel && message.event) {
          setData(message.event);
        }
      } catch (error) {
        console.error("[RT] Failed to parse message:", error);
      }
    };

    ws.addEventListener("message", handleMessage);

    // Send subscribe message
    ws.send(JSON.stringify({ type: "SUBSCRIBE", channel, timestamp: new Date().toISOString() }));

    return () => {
      ws.removeEventListener("message", handleMessage);
      ws.send(JSON.stringify({ type: "UNSUBSCRIBE", channel, timestamp: new Date().toISOString() }));
    };
  }, [connected, ws, channel]);

  return { data, connected, subscribed };
}

/**
 * Get real-time fleet status
 * Returns aggregate metrics updated live
 */
export function useRealtimeFleetStatus(orgId: string, token: string | null) {
  const { data: event, connected, subscribed } = useSubscription(`fleet-status:${orgId}`, token);

  return {
    metrics: event?.data as any,
    connected,
    subscribed,
    lastUpdate: event?.data?.updatedAt,
  };
}

/**
 * Get real-time work order updates
 * Returns latest work order changes in org
 */
export function useRealtimeWorkOrders(orgId: string, token: string | null) {
  const { data: event, connected, subscribed } = useSubscription(`work-orders:${orgId}`, token);
  const [updates, setUpdates] = useState<any[]>([]);

  // Accumulate updates
  useEffect(() => {
    if (event?.data) {
      setUpdates((prev) => [event.data, ...prev].slice(0, 50)); // Keep last 50 updates
    }
  }, [event]);

  return {
    updates,
    latest: updates[0],
    connected,
    subscribed,
    count: updates.length,
  };
}

/**
 * Get real-time vehicle health updates
 * Returns component status and alerts for a vehicle
 */
export function useRealtimeVehicleHealth(vehicleId: string, token: string | null) {
  const { data: event, connected, subscribed } = useSubscription(`vehicle-health:${vehicleId}`, token);

  return {
    health: event?.data as any,
    connected,
    subscribed,
    lastUpdate: event?.data?.updatedAt,
  };
}

/**
 * Get real-time component alerts
 * Returns alerts for vehicle components
 */
export function useRealtimeComponentAlerts(vehicleId: string, token: string | null) {
  const { data: event, connected, subscribed } = useSubscription(`components:${vehicleId}`, token);
  const [alerts, setAlerts] = useState<any[]>([]);

  useEffect(() => {
    if (event?.data) {
      setAlerts((prev) => [event.data, ...prev].slice(0, 20)); // Keep last 20 alerts
    }
  }, [event]);

  return {
    alerts,
    latest: alerts[0],
    connected,
    subscribed,
    count: alerts.length,
  };
}

/**
 * Get real-time notification feed
 * Returns notifications for current user
 */
export function useRealtimeNotifications(userId: string, token: string | null) {
  const { data: event, connected, subscribed } = useSubscription(`notifications:${userId}`, token);
  const [notifications, setNotifications] = useState<any[]>([]);

  useEffect(() => {
    if (event?.data) {
      setNotifications((prev) => [event.data, ...prev].slice(0, 100)); // Keep last 100 notifications
    }
  }, [event]);

  return {
    notifications,
    latest: notifications[0],
    connected,
    subscribed,
    unreadCount: notifications.filter((n) => !n.read).length,
  };
}

/**
 * Manual subscription hook for custom channels
 * Usage:
 *   const { subscribe, unsubscribe, data } = useManualSubscription(token);
 *   useEffect(() => { subscribe("custom-channel"); }, []);
 */
export function useManualSubscription(token: string | null) {
  const { connected, ws } = useWebSocket(token);
  const [data, setData] = useState<any>(null);

  const subscribe = useCallback(
    (channel: string) => {
      if (!connected || !ws) return;
      ws.send(JSON.stringify({ type: "SUBSCRIBE", channel, timestamp: new Date().toISOString() }));
    },
    [connected, ws]
  );

  const unsubscribe = useCallback(
    (channel: string) => {
      if (!connected || !ws) return;
      ws.send(JSON.stringify({ type: "UNSUBSCRIBE", channel, timestamp: new Date().toISOString() }));
    },
    [connected, ws]
  );

  useEffect(() => {
    if (!connected || !ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data) as RealtimeMessage;
        if (message.type === "MESSAGE" && message.event) {
          setData(message.event);
        }
      } catch (error) {
        console.error("[RT] Failed to parse message:", error);
      }
    };

    ws.addEventListener("message", handleMessage);
    return () => ws.removeEventListener("message", handleMessage);
  }, [connected, ws]);

  return { subscribe, unsubscribe, data, connected };
}

/**
 * Broadcast status indicator component hook
 * Returns connection quality indicator
 */
export function useConnectionStatus(token: string | null) {
  const { connected, ws } = useWebSocket(token);
  const [latency, setLatency] = useState<number | null>(null);
  const pingRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!connected || !ws) {
      setLatency(null);
      return;
    }

    const measureLatency = () => {
      const startTime = Date.now();

      const handlePong = () => {
        const latencyMs = Date.now() - startTime;
        setLatency(latencyMs);
        ws.removeEventListener("message", handlePong);
      };

      ws.addEventListener("message", handlePong);
      ws.send(JSON.stringify({ type: "PING", timestamp: new Date().toISOString() }));
    };

    // Measure latency every 10 seconds
    pingRef.current = setInterval(measureLatency, 10000);
    measureLatency(); // Immediate first measurement

    return () => {
      if (pingRef.current) {
        clearInterval(pingRef.current);
      }
    };
  }, [connected, ws]);

  const status = !connected ? "disconnected" : latency === null ? "connecting" : latency > 500 ? "slow" : "good";

  return { connected, latency, status };
}
