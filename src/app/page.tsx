"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "~/trpc/react";

export default function Home() {
	const [result, setResult] = useState<{
		sessionId: string;
		projectDir: string;
	} | null>(null);
	const router = useRouter();

	const createApp = api.appStarter.start.useMutation({
		onSuccess: (data) => {
			setResult(data);
			setTimeout(() => {
				router.push(`/chat?sessionId=${data.sessionId}`);
			}, 2000);
		},
		onError: (error) => {
			console.error("Error creating app:", error);
		},
	});

	const handleCreateApp = () => {
		setResult(null);
		createApp.mutate({ projectName: "MyExpoApp" });
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
							disabled={createApp.isPending}
							className="group relative transform rounded-2xl bg-black px-8 py-4 font-semibold text-lg text-white shadow-lg transition-all duration-200 hover:scale-105 hover:bg-gray-800 hover:shadow-xl disabled:transform-none disabled:cursor-not-allowed disabled:opacity-50"
						>
							<span className="relative z-10">
								{createApp.isPending ? (
									<span className="flex items-center gap-2">
										<svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" aria-label="Loading">
											<circle
												className="opacity-25"
												cx="12"
												cy="12"
												r="10"
												stroke="currentColor"
												strokeWidth="4"
												fill="none"
											/>
											<path
												className="opacity-75"
												fill="currentColor"
												d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
											/>
										</svg>
										Creating Expo App...
									</span>
								) : (
									"🚀 Create New Expo App"
								)}
							</span>
						</button>
					</div>

					{/* Success result */}
					{result && (
						<div className="mt-8 rounded-2xl border border-gray-200 bg-gray-50 p-6 shadow-sm">
							<div className="mb-4 flex items-center gap-2">
								<div className="flex h-8 w-8 items-center justify-center rounded-full bg-black">
									<svg
										className="h-5 w-5 text-white"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M5 13l4 4L19 7"
										/>
									</svg>
								</div>
								<h3 className="font-bold text-2xl text-black">
									App Created Successfully!
								</h3>
							</div>
							<div className="space-y-2 text-left">
								<p className="text-gray-700">
									<span className="font-semibold">Session ID:</span>
									<span className="ml-2 rounded border bg-white px-2 py-1 font-mono text-sm">
										{result.sessionId}
									</span>
								</p>
								<p className="text-gray-700">
									<span className="font-semibold">Project Directory:</span>
									<span className="ml-2 break-all rounded border bg-white px-2 py-1 font-mono text-sm">
										{result.projectDir}
									</span>
								</p>
								<p className="mt-4 text-center font-medium text-green-600">
									🚀 Redirecting to app builder...
								</p>
							</div>
						</div>
					)}

					{/* Error state */}
					{createApp.error && (
						<div className="mt-8 rounded-2xl border border-gray-300 bg-gray-50 p-6 shadow-sm">
							<div className="mb-4 flex items-center gap-2">
								<div className="flex h-8 w-8 items-center justify-center rounded-full bg-black">
									<svg
										className="h-5 w-5 text-white"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M6 18L18 6M6 6l12 12"
										/>
									</svg>
								</div>
								<h3 className="font-bold text-2xl text-black">
									Something went wrong
								</h3>
							</div>
							<p className="rounded-lg border bg-white p-3 text-left font-mono text-gray-700 text-sm">
								{createApp.error.message}
							</p>
						</div>
					)}
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
