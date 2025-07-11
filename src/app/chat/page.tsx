"use client";

import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { Suspense, useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import { useBuildProgress } from "~/hooks/useBuildProgress";

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
  expoUrl?: string;
  networkInfo?: {
    ip: string;
    port: number;
    url: string;
    isValidForMobile: boolean;
  };
}

// Save Build Button Component
function SaveBuildButton({ sessionId }: { sessionId: string }) {
  const [isSaved, setIsSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Check if build persistence is available
  const { data: storageConfig } = api.buildPersistence.getConfig.useQuery();

  // Save build mutation
  const saveBuild = api.buildPersistence.save.useMutation({
    onSuccess: () => {
      setIsSaved(true);
      setSaveError(null);
      setTimeout(() => setIsSaved(false), 3000); // Reset after 3 seconds
    },
    onError: (error) => {
      setSaveError(error.message);
      setTimeout(() => setSaveError(null), 5000); // Clear error after 5 seconds
    },
  });

  const handleSave = () => {
    if (saveBuild.isPending || isSaved) return;
    
    saveBuild.mutate({
      sessionId,
      projectName: `Expo App ${new Date().toLocaleDateString()}`,
    });
  };

  // Don't show if storage is not available
  if (!storageConfig?.isAvailable) {
    return null;
  }

  return (
    <div className="mt-4 space-y-2">
      <button
        onClick={handleSave}
        disabled={saveBuild.isPending || isSaved}
        className={`w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
          isSaved
            ? "bg-green-100 text-green-800 border border-green-200"
            : saveBuild.isPending
            ? "bg-gray-100 text-gray-500 border border-gray-200 cursor-not-allowed"
            : "bg-blue-100 text-blue-800 border border-blue-200 hover:bg-blue-200"
        }`}
      >
        {saveBuild.isPending ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Saving...
          </span>
        ) : isSaved ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Saved!
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            Save Build
          </span>
        )}
      </button>

      {saveError && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
          {saveError}
        </div>
      )}

      {isSaved && (
        <div className="text-xs text-green-600 bg-green-50 border border-green-200 rounded p-2">
          Build saved! You can find it in{" "}
          <a href="/builds" className="underline">My Builds</a>.
        </div>
      )}
    </div>
  );
}

function ChatPageContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("sessionId");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [canStartManually, setCanStartManually] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Track if app creation has started
  const [appCreationStarted, setAppCreationStarted] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  
  // Use polling-based progress tracking
  const { progress: buildProgress, isLoading: isLoadingProgress } = useBuildProgress({
    sessionId: sessionId || "__INVALID__",
    enabled: appCreationStarted && !!sessionId && sessionId !== "__INVALID__",
  });

  // Start app creation mutation (declare before useEffects that reference it)
  const createApp = api.appStarter.start.useMutation({
    onSuccess: (data) => {
      console.log("App creation completed:", data);
      
      // Update local state if polling hasn't caught up yet
      if (!buildProgress.isComplete && data.status === "completed") {
        // Build progress will be updated through polling
        console.log("App creation completed, progress will update via polling");
        
        // Generate QR code
        if (data.expoUrl) {
          generateQRCode(data.expoUrl);
        }
      }
    },
    onError: (error) => {
      console.error("App creation failed:", error);
      // Error will be reflected in polling data
      console.error("App creation error will be reflected in progress polling");
    },
  });

  // Generate QR code when build completes
  useEffect(() => {
    if (buildProgress.isComplete && buildProgress.expoUrl) {
      generateQRCode(buildProgress.expoUrl);
    }
  }, [buildProgress.isComplete, buildProgress.expoUrl]);

  // Enable manual start if progress doesn't start after 15 seconds or if there's an error
  useEffect(() => {
    if (
      sessionId &&
      sessionId !== "__INVALID__" &&
      appCreationStarted &&
      !buildProgress.isComplete &&
      !createApp.isPending
    ) {
      // Show manual start if progress stalls or there's an error
      const timer = setTimeout(() => {
        if (
          (buildProgress.progress === 0 || buildProgress.hasError) && 
          !buildProgress.isComplete &&
          !createApp.isPending
        ) {
          console.log(
            `[ChatPage] Enabling manual start for session: ${sessionId} (progress: ${buildProgress.progress}%, hasError: ${buildProgress.hasError})`
          );
          setCanStartManually(true);
        }
      }, 15000); // Increased timeout to 15 seconds

      return () => clearTimeout(timer);
    }
  }, [sessionId, buildProgress.progress, buildProgress.isComplete, buildProgress.hasError, appCreationStarted, createApp.isPending]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, buildProgress.logs.length]); // Add dependencies

  // Generate QR code for Expo Go
  const generateQRCode = async (expoUrl?: string) => {
    try {
      // Use provided URL or fallback to buildProgress.expoUrl or localhost
      const url = expoUrl || buildProgress.expoUrl || "exp://localhost:8081";

      console.log(`[QR] Generating QR code for: ${url}`);

      const qrUrl = await QRCode.toDataURL(url, {
        width: 256,
        margin: 2,
        color: { dark: "#000000", light: "#FFFFFF" },
      });
      setQrCodeUrl(qrUrl);
    } catch (error) {
      console.error("Error generating QR code:", error);
    }
  };

  // Validate session and check if build already exists
  useEffect(() => {
    if (!sessionId || sessionId === "__INVALID__") {
      setSessionError("Invalid session ID");
      return;
    }

    // Check if this is a refresh of an existing session
    const checkExistingBuild = async () => {
      try {
        // First check if we have progress data for this session
        const progressResponse = await fetch(`/api/trpc/appStarter.getProgress?input=${encodeURIComponent(JSON.stringify({ json: { sessionId } }))}`, {
          method: 'GET',
        });

        if (progressResponse.ok) {
          const data = await progressResponse.json();
          const sessionData = data[0]?.result?.data?.json;
          
          // If we found existing session data, don't start a new build
          if (sessionData && (sessionData.isComplete || sessionData.progress > 0)) {
            console.log(`[ChatPage] Found existing session data for: ${sessionId}`);
            setAppCreationStarted(true);
            return;
          }
        }

        // Only start new build if no existing data found
        if (!buildProgress.isComplete && !createApp.isPending && !createApp.isSuccess) {
          console.log(`[ChatPage] Starting new app creation for session: ${sessionId}`);
          startNewBuild();
        }
      } catch (error) {
        console.error(`[ChatPage] Error checking existing build:`, error);
        setSessionError("Failed to validate session. Please try creating a new app.");
      }
    };

    const startNewBuild = () => {
      setAppCreationStarted(true);
      
      // Get app description from sessionStorage if available
      const appDescription = sessionStorage.getItem(`appDescription-${sessionId}`);
      if (appDescription) {
        sessionStorage.removeItem(`appDescription-${sessionId}`); // Clean up
      }
      
      // Small delay to ensure backend is ready
      setTimeout(() => {
        createApp.mutate({
          projectName: "MyExpoApp",
          sessionId,
          appDescription: appDescription || undefined,
        });
      }, 500);
    };

    // Small delay to let component fully mount
    const timer = setTimeout(checkExistingBuild, 100);
    return () => clearTimeout(timer);
  }, [sessionId]);

  // Manual start function
  const handleManualStart = () => {
    if (sessionId && sessionId !== "__INVALID__" && !createApp.isPending) {
      console.log(
        `[ChatPage] Manual start triggered for session: ${sessionId}`
      );
      setCanStartManually(false); // Hide the button
      setAppCreationStarted(true); // Mark app creation as started
      setSessionError(null); // Clear any session errors

      // Get app description from sessionStorage if available
      const appDescription = sessionStorage.getItem(`appDescription-${sessionId}`);
      if (appDescription) {
        sessionStorage.removeItem(`appDescription-${sessionId}`); // Clean up
      }

      // Small delay before starting build
      setTimeout(() => {
        createApp.mutate({
          projectName: "MyExpoApp",
          sessionId,
          appDescription: appDescription || undefined,
        });
      }, 500);
    }
  };

  // Monitor polling status
  useEffect(() => {
    if (appCreationStarted && !buildProgress.isComplete) {
      console.log(
        `[ChatPage] Build progress: ${buildProgress.stage} - ${buildProgress.progress}%`
      );
    }
  }, [buildProgress.stage, buildProgress.progress, buildProgress.isComplete, appCreationStarted]);

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

  if (!sessionId || sessionError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white">
        <div className="text-center max-w-md">
          <h1 className="mb-4 font-bold text-2xl text-black">
            Session Issue
          </h1>
          <p className="text-gray-600 mb-6">
            {sessionError || "No session ID provided. Please go back and create a new app."}
          </p>
          <button
            onClick={() => window.location.href = '/'}
            className="px-6 py-3 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            Create New App
          </button>
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
                      {buildProgress.hasError
                        ? "Build Failed"
                        : "Building Your App"}
                    </h2>
                    <p className="text-gray-600">
                      {buildProgress.hasError
                        ? "Something went wrong during the build process"
                        : "Please wait while we create your Expo application..."}
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
                          <svg
                            className="w-5 h-5 text-white"
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
                        <h3 className="text-lg font-semibold text-red-800">
                          Build Error
                        </h3>
                      </div>
                      <p className="text-red-700 mb-4">
                        {buildProgress.message}
                      </p>
                      {buildProgress.error && (
                        <div className="bg-red-100 border border-red-200 rounded-lg p-3">
                          <p className="text-red-800 font-mono text-sm">
                            {buildProgress.error}
                          </p>
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

                  {/* Build Status */}
                  <div className="text-center space-y-2">
                    {/* Show loading state while polling */}
                    {isLoadingProgress && (
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-800">
                        <div className="w-2 h-2 rounded-full bg-gray-500 animate-pulse" />
                        Loading build status...
                      </div>
                    )}

                    {/* Manual start button */}
                    {canStartManually &&
                      !buildProgress.isComplete &&
                      !createApp.isPending && (
                        <div className="text-center space-y-2">
                          <p className="text-orange-600 text-sm">
                            {buildProgress.hasError 
                              ? "Build encountered an error. Try restarting." 
                              : "Build is taking longer than expected."}
                          </p>
                          <div className="space-x-2">
                            <button
                              onClick={handleManualStart}
                              className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition-colors"
                            >
                              {buildProgress.hasError ? "Retry Build" : "Start Building App"}
                            </button>
                            <button
                              onClick={() => window.location.href = '/'}
                              className="px-4 py-2 bg-gray-600 text-white text-sm rounded hover:bg-gray-700 transition-colors"
                            >
                              Create New App
                            </button>
                          </div>
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
                    className={`flex ${
                      message.sender === "user"
                        ? "justify-end"
                        : "justify-start"
                    }`}
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

                    {/* Network status and instructions */}
                    <div className="space-y-2 text-gray-600 text-sm">
                      {buildProgress.networkInfo && (
                        <div
                          className={`p-2 rounded ${
                            buildProgress.networkInfo.isValidForMobile
                              ? "bg-green-50 text-green-700"
                              : "bg-yellow-50 text-yellow-700"
                          }`}
                        >
                          {buildProgress.networkInfo.isValidForMobile ? (
                            <p>✅ Network ready for mobile devices</p>
                          ) : (
                            <p>
                              ⚠️ Using localhost - only works on this machine
                            </p>
                          )}
                          <p className="text-xs">
                            Server: {buildProgress.networkInfo.ip}:
                            {buildProgress.networkInfo.port}
                          </p>
                        </div>
                      )}

                      <p className="font-medium">📱 Scan with Expo Go</p>
                      <p>1. Install Expo Go from your app store</p>
                      <p>2. Open Expo Go and scan this QR code</p>
                      <p>3. Your app will load instantly!</p>

                      {buildProgress.expoUrl && (
                        <div className="mt-2 p-2 bg-gray-50 rounded text-xs font-mono">
                          {buildProgress.expoUrl}
                        </div>
                      )}
                    </div>

                    {/* Save Build Button */}
                    <SaveBuildButton sessionId={sessionId!} />
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
                          <svg
                            className="w-6 h-6 text-white"
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
                        <div className="text-red-600 text-sm">Build Failed</div>
                      </div>
                    ) : (
                      <div className="text-center">
                        <div className="animate-spin w-12 h-12 border-4 border-gray-200 border-t-black rounded-full mx-auto mb-2"></div>
                        <div className="text-gray-500 text-sm">
                          Building App...
                        </div>
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
    <Suspense
      fallback={
        <main className="min-h-screen bg-white flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-black mb-4">Loading...</h1>
            <p className="text-gray-600">Setting up your app builder...</p>
          </div>
        </main>
      }
    >
      <ChatPageContent />
    </Suspense>
  );
}
