import { useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";

export interface BuildProgress {
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

interface UseBuildProgressOptions {
  sessionId: string;
  enabled?: boolean;
  pollingInterval?: number;
}

export function useBuildProgress({ 
  sessionId, 
  enabled = true,
  pollingInterval = 2000 // Poll every 2 seconds
}: UseBuildProgressOptions) {
  const [progress, setProgress] = useState<BuildProgress>({
    stage: "Initializing",
    message: "Setting up your workspace...",
    progress: 0,
    isComplete: false,
    hasError: false,
    logs: [],
  });
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Use tRPC query with refetch
  const { data, error, refetch } = api.appStarter.getProgress.useQuery(
    { sessionId },
    {
      enabled: enabled && sessionId !== "__INVALID__",
      refetchInterval: progress.isComplete || progress.hasError ? false : pollingInterval,
    }
  );
  
  // Update progress when data changes
  useEffect(() => {
    if (data) {
      setProgress(prev => ({
        ...prev,
        ...data,
        logs: [...prev.logs, ...(data.newLogs || [])]
      }));
    }
  }, [data]);
  
  // Handle completion
  useEffect(() => {
    if (progress.isComplete || progress.hasError) {
      // Stop polling when done
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [progress.isComplete, progress.hasError]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);
  
  return {
    progress,
    isLoading: !data && !error,
    error,
    refetch
  };
}