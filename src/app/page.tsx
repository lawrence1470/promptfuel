"use client";

import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";

export default function Home() {
	const router = useRouter();

	const handleCreateApp = () => {
		// Generate session ID immediately
		const sessionId = uuidv4();
		
		// Redirect immediately to chat page
		router.push(`/chat?sessionId=${sessionId}`);
	};

	return (
		<main className="min-h-screen bg-white">
			{/* Header */}
			<div className="border-gray-200 border-b">
				<div className="px-6 py-4">
					<h1 className="font-bold text-2xl text-black">PromptFuel</h1>
				</div>
			</div>

			{/* Main content */}
			<div className="flex flex-col items-center justify-center px-4 py-20">
				<div className="max-w-2xl space-y-8 text-center">
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

					{/* Action button */}
					<div className="pt-8">
						<button
							type="button"
							onClick={handleCreateApp}
							className="group relative transform rounded-2xl bg-black px-8 py-4 font-semibold text-lg text-white shadow-lg transition-all duration-200 hover:scale-105 hover:bg-gray-800 hover:shadow-xl"
						>
							🚀 Create New Expo App
						</button>
					</div>
				</div>
			</div>

			{/* Footer */}
			<footer className="mt-20 border-gray-200 border-t py-8">
				<div className="text-center text-gray-500">
					<p>Build powerful mobile apps with AI-powered generation</p>
				</div>
			</footer>
		</main>
	);
}
