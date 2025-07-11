"use client";

import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { Suspense, useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import { useServerSentEvents, type SSEMessage } from "~/hooks/useServerSentEvents";

interface Message {
	id: string;
	content: string;
	sender: "user" | "ai";
	timestamp: Date;
}

interface BuildProgress {
	stage: string;
	message: string;
	progress: number;
	isComplete: boolean;
	hasError: boolean;
	error?: string;
	logs: string[];
}

function ChatPageContent() {
	const searchParams = useSearchParams();
	const sessionId = searchParams.get("sessionId");
	const [messages, setMessages] = useState<Message[]>([]);
	const [inputMessage, setInputMessage] = useState("");
	const [qrCodeUrl, setQrCodeUrl] = useState("");
	const [buildProgress, setBuildProgress] = useState<BuildProgress>({
		stage: "Initializing",
		message: "Setting up your workspace...",
		progress: 0,
		isComplete: false,
		hasError: false,
		logs: []
	});
	const messagesEndRef = useRef<HTMLDivElement>(null);

	// SSE connection for real-time progress
	const { isConnected, isConnecting, error: connectionError, lastMessage, reconnect } = useServerSentEvents({
		sessionId: sessionId || "",
		onMessage: (message: SSEMessage) => {
			console.log("SSE message:", message);
			
			switch (message.type) {
				case "progress":
					setBuildProgress(prev => ({
						...prev,
						stage: message.stage || prev.stage,
						message: message.message || prev.message,
						progress: message.progress || prev.progress,
						logs: message.message ? [...prev.logs, message.message] : prev.logs
					}));
					break;
					
				case "output":
					setBuildProgress(prev => ({
						...prev,
						logs: [...prev.logs, message.message || ""]
					}));
					break;
					
				case "completed":
					setBuildProgress(prev => ({
						...prev,
						stage: "Build Complete",
						message: "Your Expo app is ready!",
						progress: 100,
						isComplete: true,
						logs: [...prev.logs, message.message || "Build completed successfully"]
					}));
					// Generate QR code when build completes
					generateQRCode();
					break;
					
				case "error":
					setBuildProgress(prev => ({
						...prev,
						stage: "Build Failed",
						message: message.message || "An error occurred",
						hasError: true,
						error: message.error,
						logs: [...prev.logs, `ERROR: ${message.message || "Unknown error"}`]
					}));
					break;
			}
		},
		onError: (error) => {
			console.error("SSE error:", error);
			
			// Don't immediately mark as error - let SSE hook handle reconnection
			// Only show persistent error if connection fails completely
		},
		onClose: () => {
			console.log("SSE connection closed");
			// Connection closed, but this might be temporary
		}
	});

	// Auto-scroll to bottom when new messages arrive
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	});

	// Generate QR code for Expo Go
	const generateQRCode = async () => {
		try {
			const expoUrl = "exp://localhost:8081";
			const qrUrl = await QRCode.toDataURL(expoUrl, {
				width: 256,
				margin: 2,
				color: { dark: "#000000", light: "#FFFFFF" },
			});
			setQrCodeUrl(qrUrl);
		} catch (error) {
			console.error("Error generating QR code:", error);
		}
	};

	// Start app creation when component mounts
	const createApp = api.appStarter.start.useMutation({
		onSuccess: (data) => {
			console.log("App creation completed:", data);
		},
		onError: (error) => {
			console.error("App creation failed:", error);
			setBuildProgress(prev => ({
				...prev,
				hasError: true,
				error: error.message,
				stage: "Build Failed",
				message: "Failed to create app"
			}));
		}
	});

	// Auto-start app creation when page loads and SSE is connected
	useEffect(() => {
		if (sessionId && !buildProgress.isComplete && !createApp.isPending && !createApp.isSuccess && isConnected) {
			// Small delay to ensure SSE connection is fully established
			setTimeout(() => {
				createApp.mutate({ 
					projectName: "MyExpoApp", 
					sessionId 
				});
			}, 500);
		}
	}, [sessionId, buildProgress.isComplete, createApp, isConnected]);

	const sendMessage = api.chat.sendMessage.useMutation({
		onSuccess: (response) => {
			setMessages((prev) => [
				...prev,
				{
					id: `${Date.now()}-ai`,
					content: response.response,
					sender: "ai",
					timestamp: new Date(),
				},
			]);
		},
		onError: (error) => {
			console.error("Error sending message:", error);
		},
	});

	const handleSendMessage = () => {
		if (!inputMessage.trim() || !sessionId || sendMessage.isPending) return;

		const userMessage: Message = {
			id: `${Date.now()}-user`,
			content: inputMessage.trim(),
			sender: "user",
			timestamp: new Date(),
		};

		setMessages((prev) => [...prev, userMessage]);
		sendMessage.mutate({ sessionId, message: inputMessage.trim() });
		setInputMessage("");
	};

	const handleKeyPress = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSendMessage();
		}
	};

	if (!sessionId) {
		return (
			<main className="flex min-h-screen items-center justify-center bg-white">
				<div className="text-center">
					<h1 className="mb-4 font-bold text-2xl text-black">
						Invalid Session
					</h1>
					<p className="text-gray-600">
						No session ID provided. Please go back and create a new app.
					</p>
				</div>
			</main>
		);
	}

	return (
		<main className="min-h-screen bg-white">
			{/* Header */}
			<div className="border-gray-200 border-b">
				<div className="px-6 py-4">
					<h1 className="font-bold text-2xl text-black">
						PromptFuel - App Builder
					</h1>
					<p className="text-gray-600 text-sm">Session: {sessionId}</p>
				</div>
			</div>

			{/* Main Content */}
			<div className="flex h-[calc(100vh-80px)]">
				{/* Chat Section */}
				<div className="flex flex-1 flex-col">
					{/* Messages Area */}
					<div className="flex-1 overflow-y-auto p-6">
						{!buildProgress.isComplete ? (
							/* Build Progress UI */
							<div className="flex flex-col items-center justify-center h-full space-y-6">
								<div className="max-w-2xl w-full space-y-6">
									<div className="text-center">
										<h2 className="text-3xl font-bold text-black mb-2">
											{buildProgress.hasError ? "Build Failed" : "Building Your App"}
										</h2>
										<p className="text-gray-600">
											{buildProgress.hasError 
												? "Something went wrong during the build process"
												: "Please wait while we create your Expo application..."
											}
										</p>
									</div>

									{/* Progress Bar */}
									{!buildProgress.hasError && (
										<div className="space-y-3">
											<div className="flex justify-between text-sm text-gray-600">
												<span>{buildProgress.stage}</span>
												<span>{buildProgress.progress}%</span>
											</div>
											<div className="w-full bg-gray-200 rounded-full h-3">
												<div 
													className="bg-black h-3 rounded-full transition-all duration-500 ease-out"
													style={{ width: `${buildProgress.progress}%` }}
												/>
											</div>
											<p className="text-sm text-gray-500 text-center">
												{buildProgress.message}
											</p>
										</div>
									)}

									{/* Error Display */}
									{buildProgress.hasError && (
										<div className="bg-red-50 border border-red-200 rounded-xl p-6">
											<div className="flex items-center gap-3 mb-4">
												<div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
													<svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
													</svg>
												</div>
												<h3 className="text-lg font-semibold text-red-800">Build Error</h3>
											</div>
											<p className="text-red-700 mb-4">{buildProgress.message}</p>
											{buildProgress.error && (
												<div className="bg-red-100 border border-red-200 rounded-lg p-3">
													<p className="text-red-800 font-mono text-sm">{buildProgress.error}</p>
												</div>
											)}
											<button
												onClick={() => window.location.reload()}
												className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
											>
												Try Again
											</button>
										</div>
									)}

									{/* Build Logs */}
									{buildProgress.logs.length > 0 && (
										<details className="bg-gray-50 border border-gray-200 rounded-xl p-4">
											<summary className="cursor-pointer font-medium text-gray-700 mb-2">
												View Build Logs ({buildProgress.logs.length} entries)
											</summary>
											<div className="max-h-40 overflow-y-auto bg-black text-green-400 p-3 rounded font-mono text-sm">
												{buildProgress.logs.map((log, index) => (
													<div key={index} className="mb-1">
														{log}
													</div>
												))}
											</div>
										</details>
									)}

									{/* Connection Status */}
									<div className="text-center space-y-2">
										<div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
											isConnected ? 'bg-green-100 text-green-800' : 
											isConnecting ? 'bg-yellow-100 text-yellow-800' :
											'bg-red-100 text-red-800'
										}`}>
											<div className={`w-2 h-2 rounded-full ${
												isConnected ? 'bg-green-500' : 
												isConnecting ? 'bg-yellow-500 animate-pulse' :
												'bg-red-500'
											}`} />
											{isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected'}
										</div>
										
										{/* Error message and recovery */}
										{connectionError && !isConnecting && (
											<div className="text-center space-y-2">
												<p className="text-red-600 text-sm">{connectionError}</p>
												{!isConnected && (
													<button
														onClick={reconnect}
														className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
													>
														Retry Connection
													</button>
												)}
											</div>
										)}
									</div>
								</div>
							</div>
						) : messages.length === 0 ? (
							<div className="mt-20 text-center text-gray-500">
								<h2 className="mb-2 font-semibold text-xl">
									Your Expo app is ready!
								</h2>
								<p>Start chatting to customize and enhance your application.</p>
							</div>
						) : (
							<div className="mx-auto max-w-4xl space-y-4">
								{messages.map((message) => (
									<div
										key={message.id}
										className={`flex ${message.sender === "user" ? "justify-end" : "justify-start"}`}
									>
										<div
											className={`max-w-xs rounded-2xl px-4 py-2 lg:max-w-md ${
												message.sender === "user"
													? "bg-black text-white"
													: "border border-gray-200 bg-gray-100 text-black"
											}`}
										>
											<p className="whitespace-pre-wrap text-sm">
												{message.content}
											</p>
											<span className="mt-1 block text-xs opacity-70">
												{message.timestamp.toLocaleTimeString()}
											</span>
										</div>
									</div>
								))}
								{sendMessage.isPending && (
									<div className="flex justify-start">
										<div className="rounded-2xl border border-gray-200 bg-gray-100 px-4 py-2 text-black">
											<div className="flex items-center space-x-1">
												<div className="h-2 w-2 animate-bounce rounded-full bg-gray-400"></div>
												<div className="h-2 w-2 animate-bounce rounded-full bg-gray-400 delay-100"></div>
												<div className="h-2 w-2 animate-bounce rounded-full bg-gray-400 delay-200"></div>
											</div>
										</div>
									</div>
								)}
								<div ref={messagesEndRef} />
							</div>
						)}
					</div>

					{/* Input Area */}
					{buildProgress.isComplete && (
						<div className="border-gray-200 border-t p-6">
							<div className="flex space-x-4">
								<input
									type="text"
									value={inputMessage}
									onChange={(e) => setInputMessage(e.target.value)}
									onKeyPress={handleKeyPress}
									placeholder="Describe how you want to modify your app..."
									className="flex-1 rounded-xl border border-gray-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-black"
									disabled={sendMessage.isPending}
								/>
								<button
									type="button"
									onClick={handleSendMessage}
									disabled={sendMessage.isPending || !inputMessage.trim()}
									className="rounded-xl bg-black px-6 py-3 text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
								>
									Send
								</button>
							</div>
						</div>
					)}
				</div>

				{/* QR Code Section */}
				<div className="w-80 border-gray-200 border-l bg-gray-50 p-6">
					<div className="text-center">
						{buildProgress.isComplete ? (
							<>
								<h3 className="mb-4 font-semibold text-black text-lg">
									Preview Your App
								</h3>

								{qrCodeUrl ? (
									<div className="space-y-4">
										<div className="inline-block rounded-xl border border-gray-200 bg-white p-4">
											<img
												src={qrCodeUrl}
												alt="QR Code for Expo Go"
												className="h-48 w-48"
											/>
										</div>
										<div className="space-y-2 text-gray-600 text-sm">
											<p className="font-medium">📱 Scan with Expo Go</p>
											<p>1. Install Expo Go from your app store</p>
											<p>2. Open Expo Go and scan this QR code</p>
											<p>3. Your app will load instantly!</p>
										</div>
									</div>
								) : (
									<div className="mx-auto flex h-48 w-48 items-center justify-center rounded-xl border border-gray-200 bg-white p-4">
										<div className="text-gray-500">Generating QR code...</div>
									</div>
								)}

								<div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 text-left">
									<h4 className="mb-2 font-semibold text-black">💡 Tips:</h4>
									<ul className="space-y-1 text-gray-600 text-sm">
										<li>• Ask me to add new features</li>
										<li>• Request UI/UX improvements</li>
										<li>• Add navigation or screens</li>
										<li>• Integrate APIs or data</li>
									</ul>
								</div>
							</>
						) : (
							<>
								<h3 className="mb-4 font-semibold text-black text-lg">
									{buildProgress.hasError ? "Build Status" : "Building..."}
								</h3>
								
								<div className="space-y-4">
									<div className="mx-auto flex h-48 w-48 items-center justify-center rounded-xl border border-gray-200 bg-white p-4">
										{buildProgress.hasError ? (
											<div className="text-center">
												<div className="w-12 h-12 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-2">
													<svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
													</svg>
												</div>
												<div className="text-red-600 text-sm">Build Failed</div>
											</div>
										) : (
											<div className="text-center">
												<div className="animate-spin w-12 h-12 border-4 border-gray-200 border-t-black rounded-full mx-auto mb-2"></div>
												<div className="text-gray-500 text-sm">Building App...</div>
											</div>
										)}
									</div>
									
									<div className="text-gray-600 text-sm space-y-1">
										<p>📱 QR code will appear here when ready</p>
										<p>🔨 Your app is being prepared...</p>
									</div>
								</div>
							</>
						)}
					</div>
				</div>
			</div>
		</main>
	);
}

export default function ChatPage() {
	return (
		<Suspense fallback={
			<main className="min-h-screen bg-white flex items-center justify-center">
				<div className="text-center">
					<h1 className="text-2xl font-bold text-black mb-4">Loading...</h1>
					<p className="text-gray-600">Setting up your app builder...</p>
				</div>
			</main>
		}>
			<ChatPageContent />
		</Suspense>
	);
}
