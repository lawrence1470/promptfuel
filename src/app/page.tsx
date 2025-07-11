"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { v4 as uuidv4 } from "uuid";

export default function Home() {
	const router = useRouter();
	const [appDescription, setAppDescription] = useState("");
	const [isCreating, setIsCreating] = useState(false);

	const handleCreateApp = async () => {
		if (isCreating) return;
		
		setIsCreating(true);
		
		// Generate session ID immediately
		const sessionId = uuidv4();
		
		// Store app description in sessionStorage if provided
		if (appDescription.trim()) {
			sessionStorage.setItem(`appDescription-${sessionId}`, appDescription.trim());
		}
		
		// Redirect immediately to chat page
		router.push(`/chat?sessionId=${sessionId}`);
	};

	return (
		<main className="min-h-screen bg-white">
			{/* Header */}
			<div className="border-gray-200 border-b">
				<div className="px-6 py-4 flex items-center justify-between">
					<h1 className="font-bold text-2xl text-black">PromptFuel</h1>
					<nav className="flex items-center gap-4">
						<a
							href="/builds"
							className="px-4 py-2 text-gray-600 hover:text-black transition-colors rounded-lg hover:bg-gray-50"
						>
							My Builds
						</a>
					</nav>
				</div>
			</div>

			{/* Main content */}
			<div className="flex flex-col items-center justify-center px-4 py-20">
				<div className="max-w-2xl w-full space-y-8 text-center">
					{/* Hero section */}
					<div className="space-y-4">
						<h2 className="font-extrabold text-5xl text-black sm:text-6xl">
							Create Amazing Apps
						</h2>
						<p className="mx-auto max-w-xl text-gray-600 text-xl">
							Generate custom mobile applications from natural language prompts
							in seconds
						</p>
					</div>

					{/* App description input */}
					<div className="max-w-lg mx-auto space-y-4">
						<div className="text-left">
							<label htmlFor="appDescription" className="block text-sm font-medium text-gray-700 mb-2">
								Describe your app (optional)
							</label>
							<textarea
								id="appDescription"
								rows={4}
								className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent resize-none"
								placeholder="e.g., A todo list app with dark mode and categories..."
								value={appDescription}
								onChange={(e) => setAppDescription(e.target.value)}
								disabled={isCreating}
							/>
							<p className="mt-2 text-sm text-gray-500">
								Claude will generate a custom app based on your description
							</p>
						</div>
					</div>

					{/* Action button */}
					<div className="pt-4">
						<button
							type="button"
							onClick={handleCreateApp}
							disabled={isCreating}
							className={`group relative transform rounded-2xl px-8 py-4 font-semibold text-lg text-white shadow-lg transition-all duration-200 ${
								isCreating 
									? "bg-gray-400 cursor-not-allowed" 
									: "bg-black hover:scale-105 hover:bg-gray-800 hover:shadow-xl"
							}`}
						>
							{isCreating ? (
								<span className="flex items-center gap-2">
									<svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
										<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
										<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
									</svg>
									Creating...
								</span>
							) : (
								"🚀 Create New Expo App"
							)}
						</button>
					</div>
				</div>
			</div>

			{/* Features section */}
			<div className="mt-20 px-4 pb-20">
				<div className="max-w-4xl mx-auto">
					<h3 className="text-2xl font-bold text-center mb-12">Powered by Claude AI</h3>
					<div className="grid md:grid-cols-3 gap-8">
						<div className="text-center space-y-3">
							<div className="w-16 h-16 bg-black rounded-full flex items-center justify-center mx-auto">
								<span className="text-2xl">🤖</span>
							</div>
							<h4 className="font-semibold">AI Code Generation</h4>
							<p className="text-gray-600 text-sm">
								Claude generates complete React Native components from your descriptions
							</p>
						</div>
						<div className="text-center space-y-3">
							<div className="w-16 h-16 bg-black rounded-full flex items-center justify-center mx-auto">
								<span className="text-2xl">⚡</span>
							</div>
							<h4 className="font-semibold">Real-time Updates</h4>
							<p className="text-gray-600 text-sm">
								See your changes instantly in Expo Go as you chat
							</p>
						</div>
						<div className="text-center space-y-3">
							<div className="w-16 h-16 bg-black rounded-full flex items-center justify-center mx-auto">
								<span className="text-2xl">📱</span>
							</div>
							<h4 className="font-semibold">Mobile Ready</h4>
							<p className="text-gray-600 text-sm">
								Test on your device immediately with QR code scanning
							</p>
						</div>
					</div>
				</div>
			</div>

			{/* Footer */}
			<footer className="border-gray-200 border-t py-8">
				<div className="text-center text-gray-500">
					<p>Build powerful mobile apps with AI-powered generation</p>
				</div>
			</footer>
		</main>
	);
}