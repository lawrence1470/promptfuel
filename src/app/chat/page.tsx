"use client";

import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { Suspense, useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";

interface Message {
	id: string;
	content: string;
	sender: "user" | "ai";
	timestamp: Date;
}

function ChatPageContent() {
	const searchParams = useSearchParams();
	const sessionId = searchParams.get("sessionId");
	const [messages, setMessages] = useState<Message[]>([]);
	const [inputMessage, setInputMessage] = useState("");
	const [qrCodeUrl, setQrCodeUrl] = useState("");
	const messagesEndRef = useRef<HTMLDivElement>(null);

	// Auto-scroll to bottom when new messages arrive
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	});

	// Generate QR code for Expo Go
	useEffect(() => {
		const generateQR = async () => {
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
		generateQR();
	}, []);

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
						{messages.length === 0 ? (
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
				</div>

				{/* QR Code Section */}
				<div className="w-80 border-gray-200 border-l bg-gray-50 p-6">
					<div className="text-center">
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
