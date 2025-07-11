import { useEffect, useRef, useState, useCallback } from "react";

export interface SSEMessage {
	type: "progress" | "output" | "completed" | "error" | "connected" | "ping" | "keepalive";
	sessionId?: string;
	message?: string;
	progress?: number;
	stage?: string;
	data?: any;
	error?: string;
	timestamp?: number;
}

export interface UseSSEOptions {
	sessionId: string;
	onMessage?: (message: SSEMessage) => void;
	onError?: (error: Event) => void;
	onOpen?: () => void;
	onClose?: () => void;
	reconnectAttempts?: number;
	reconnectInterval?: number;
}

export interface UseSSEReturn {
	isConnected: boolean;
	isConnecting: boolean;
	error: string | null;
	sendMessage: (message: any) => boolean;
	lastMessage: SSEMessage | null;
	reconnect: () => void;
	disconnect: () => void;
}

export function useServerSentEvents({
	sessionId,
	onMessage,
	onError,
	onOpen,
	onClose,
	reconnectAttempts = 5,
	reconnectInterval = 3000,
}: UseSSEOptions): UseSSEReturn {
	const [isConnected, setIsConnected] = useState(false);
	const [isConnecting, setIsConnecting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [lastMessage, setLastMessage] = useState<SSEMessage | null>(null);

	const eventSourceRef = useRef<EventSource | null>(null);
	const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const reconnectCountRef = useRef(0);
	const connectAttemptRef = useRef<number>(0);
	const isMountedRef = useRef(true);

	const connect = useCallback(() => {
		if (!isMountedRef.current || !sessionId || isConnecting) {
			return;
		}

		// Prevent rapid reconnections and React strict mode double connections
		if (eventSourceRef.current) {
			console.log(`[SSE] Connection already exists for session: ${sessionId}`);
			return;
		}

		// Rate limit connection attempts (max 1 per 2 seconds)
		const now = Date.now();
		const lastConnectAttempt = connectAttemptRef.current;
		if (lastConnectAttempt && (now - lastConnectAttempt) < 2000) {
			console.log(`[SSE] Rate limiting connection attempt for session: ${sessionId}`);
			return;
		}
		connectAttemptRef.current = now;

		console.log(`[SSE] Connecting to session: ${sessionId}`);
		setIsConnecting(true);
		setError(null);

		try {
			// Create EventSource directly - the server will handle connection limits
			console.log(`[SSE] Creating EventSource for session: ${sessionId}`);
			const eventSource = new EventSource(`/api/events/${sessionId}`);
			eventSourceRef.current = eventSource;
			
			console.log(`[SSE] EventSource created, initial readyState: ${eventSource.readyState}`);

			eventSource.onopen = () => {
				console.log(`[SSE] onopen fired for session: ${sessionId}`);
				console.log(`[SSE] EventSource readyState: ${eventSource.readyState}`);
				setIsConnected(true);
				setIsConnecting(false);
				setError(null);
				reconnectCountRef.current = 0;
				onOpen?.();
			};

			eventSource.onmessage = (event) => {
				try {
					const message: SSEMessage = JSON.parse(event.data);
					console.log(`[SSE] Received message:`, message);
					
					// Ensure we're marked as connected when receiving any message
					if (!isConnected) {
						console.log(`[SSE] Setting connected state from message for session: ${sessionId}`);
						setIsConnected(true);
						setIsConnecting(false);
						setError(null);
						reconnectCountRef.current = 0;
						onOpen?.();
					}
					
					// Skip internal messages (heartbeat, ping, keepalive, etc.)
					if (message.message === "heartbeat" || 
						message.type === "ping" || 
						message.type === "connected" || 
						message.type === "keepalive") {
						return;
					}
					
					setLastMessage(message);
					onMessage?.(message);
				} catch (error) {
					console.error(`[SSE] Failed to parse message:`, error);
				}
			};

			eventSource.onerror = (event) => {
				console.error(`[SSE] Connection error for session: ${sessionId}`, event);
				
				setIsConnected(false);
				setIsConnecting(false);
				
				// Detailed error classification
				let errorMessage = "Connection error";
				let shouldRetry = true;
				let isServerError = false;
				
				// Check the event target for more details
				const target = event.target as EventSource;
				
				if (target.readyState === EventSource.CLOSED) {
					// Check if this was a server error by looking at recent network activity
					fetch(`/api/events/${sessionId}`, { method: 'POST' })
						.then(response => {
							if (!response.ok) {
								if (response.status >= 500) {
									errorMessage = "Server error - retrying...";
									isServerError = true;
								} else if (response.status === 429) {
									errorMessage = "Too many connections - backing off";
									shouldRetry = false;
								} else if (response.status === 404) {
									errorMessage = "Session not found";
									shouldRetry = false;
								} else {
									errorMessage = `Server error (${response.status})`;
									isServerError = true;
								}
							} else {
								errorMessage = "Connection lost - reconnecting...";
							}
						})
						.catch(() => {
							errorMessage = "Server unavailable - retrying...";
							isServerError = true;
						});
					
					errorMessage = "Connection closed by server";
				} else if (target.readyState === EventSource.CONNECTING) {
					errorMessage = "Reconnecting...";
				}
					
				setError(errorMessage);
				onError?.(event);

				// Smart retry logic based on error type
				if (shouldRetry && 
					reconnectCountRef.current < reconnectAttempts && 
					target.readyState === EventSource.CLOSED) {
					
					reconnectCountRef.current++;
					
					// Different backoff strategies for different error types
					let backoffDelay;
					if (isServerError) {
						// Longer backoff for server errors (30s, 60s, 120s)
						backoffDelay = Math.min(30000 * Math.pow(2, reconnectCountRef.current - 1), 300000);
					} else {
						// Normal backoff for network issues (3s, 6s, 12s, 24s)
						backoffDelay = Math.min(reconnectInterval * Math.pow(2, reconnectCountRef.current - 1), 30000);
					}
					
					console.log(`[SSE] Reconnecting... attempt ${reconnectCountRef.current}/${reconnectAttempts} in ${backoffDelay}ms (${isServerError ? 'server error' : 'network error'})`);
					
					// Clean up current connection first
					eventSourceRef.current = null;
					
					reconnectTimeoutRef.current = setTimeout(() => {
						if (isMountedRef.current) {
							connect();
						}
					}, backoffDelay);
				} else {
					console.log(`[SSE] Not reconnecting for session: ${sessionId} (attempts: ${reconnectCountRef.current}, shouldRetry: ${shouldRetry})`);
					if (reconnectCountRef.current >= reconnectAttempts) {
						setError("Connection failed after multiple attempts - please refresh the page");
					} else {
						setError("Connection failed - please refresh the page");
					}
					eventSourceRef.current = null;
				}
			};

		} catch (error) {
			console.error(`[SSE] Failed to create EventSource:`, error);
			setIsConnecting(false);
			setError("Failed to establish connection");
			onError?.(error as Event);
		}
	}, [sessionId, isConnecting]); // Simplified dependencies

	const disconnect = useCallback(() => {
		console.log(`[SSE] Disconnecting from session: ${sessionId}`);
		
		// Clear any pending reconnection attempts
		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current);
			reconnectTimeoutRef.current = null;
		}

		// Close the EventSource connection
		if (eventSourceRef.current) {
			try {
				eventSourceRef.current.close();
			} catch (error) {
				console.error(`[SSE] Error closing EventSource:`, error);
			}
			eventSourceRef.current = null;
		}

		setIsConnected(false);
		setIsConnecting(false);
		onClose?.();
	}, [sessionId]); // Simplified dependencies

	const reconnect = useCallback(() => {
		console.log(`[SSE] Manual reconnect requested for session: ${sessionId}`);
		reconnectCountRef.current = 0; // Reset reconnect counter
		disconnect();
		setTimeout(() => {
			if (isMountedRef.current) {
				connect();
			}
		}, 1000);
	}, [sessionId]); // Simplified dependencies

	const sendMessage = useCallback((message: any): boolean => {
		// SSE is unidirectional (server -> client only)
		// For client -> server communication, use regular HTTP requests
		console.warn("[SSE] sendMessage not supported in SSE mode. Use HTTP requests for client->server communication.");
		return false;
	}, []);

	// Connect on mount and when sessionId changes
	useEffect(() => {
		isMountedRef.current = true;
		
		if (sessionId) {
			console.log(`[SSE] useEffect triggered for session: ${sessionId}`);
			
			// Small delay to prevent React strict mode double connections
			const timeoutId = setTimeout(() => {
				if (isMountedRef.current) {
					console.log(`[SSE] useEffect timeout executing connect for session: ${sessionId}`);
					connect();
				} else {
					console.log(`[SSE] useEffect timeout skipped - component unmounted for session: ${sessionId}`);
				}
			}, 100);

			// Cleanup function
			return () => {
				console.log(`[SSE] useEffect cleanup called for session: ${sessionId}`);
				clearTimeout(timeoutId);
				isMountedRef.current = false;
				disconnect();
			};
		}
	}, [sessionId]); // Only depend on sessionId, not connect/disconnect functions

	return {
		isConnected,
		isConnecting,
		error,
		sendMessage,
		lastMessage,
		reconnect,
		disconnect,
	};
}