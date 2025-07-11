"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { formatDistanceToNow } from "date-fns";

export default function BuildsPage() {
  const [selectedBuild, setSelectedBuild] = useState<string | null>(null);

  // Fetch builds list
  const { data: buildsData, isLoading, refetch } = api.buildPersistence.list.useQuery({
    includeShared: false,
    limit: 50,
  });

  // Get storage configuration
  const { data: storageConfig } = api.buildPersistence.getConfig.useQuery();

  // Mutations
  const deleteBuild = api.buildPersistence.delete.useMutation({
    onSuccess: () => {
      refetch();
      setSelectedBuild(null);
    },
  });

  const shareBuild = api.buildPersistence.share.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  const handleRestore = (sessionId: string) => {
    // Navigate to chat page with the session ID to restore
    window.location.href = `/chat?sessionId=${sessionId}&restore=true`;
  };

  const handleDelete = async (sessionId: string) => {
    if (confirm("Are you sure you want to delete this build? This action cannot be undone.")) {
      try {
        await deleteBuild.mutateAsync({ sessionId });
      } catch (error) {
        console.error("Failed to delete build:", error);
        alert("Failed to delete build. Please try again.");
      }
    }
  };

  const handleShare = async (sessionId: string) => {
    try {
      const result = await shareBuild.mutateAsync({ sessionId });
      if (result.shareUrl) {
        // Copy share URL to clipboard
        await navigator.clipboard.writeText(result.shareUrl);
        alert(`Share link copied to clipboard:\n${result.shareUrl}`);
      }
    } catch (error) {
      console.error("Failed to create share link:", error);
      alert("Failed to create share link. Please try again.");
    }
  };

  if (isLoading) {
    return (
      <main className="min-h-screen bg-white">
        <div className="max-w-7xl mx-auto py-8 px-4">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-black mb-8">My Builds</h1>
            <div className="flex items-center justify-center">
              <div className="animate-spin w-8 h-8 border-4 border-gray-200 border-t-black rounded-full"></div>
              <span className="ml-3 text-gray-600">Loading your builds...</span>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (!storageConfig?.isAvailable) {
    return (
      <main className="min-h-screen bg-white">
        <div className="max-w-7xl mx-auto py-8 px-4">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-black mb-8">My Builds</h1>
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 max-w-md mx-auto">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-yellow-800">
                  Build Persistence Not Configured
                </h3>
              </div>
              <p className="text-yellow-700 mb-4">
                Build persistence requires object storage configuration. Please set up Cloudflare R2 to save and restore your builds.
              </p>
              <button
                onClick={() => window.location.href = '/'}
                className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
              >
                Create New Build
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const builds = buildsData?.builds || [];

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-7xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-black">My Builds</h1>
            <p className="text-gray-600 mt-2">
              {builds.length} saved build{builds.length !== 1 ? 's' : ''}
              {storageConfig && (
                <span className="ml-4 text-sm">
                  Storage: {Math.round((builds.reduce((acc, build) => acc + build.sizeBytes, 0) / 1024 / 1024) * 100) / 100} MB used
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => window.location.href = '/'}
            className="px-6 py-3 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            Create New Build
          </button>
        </div>

        {/* Builds Grid */}
        {builds.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No saved builds</h3>
            <p className="text-gray-600 mb-6">Create your first Expo app and save it to see it here.</p>
            <button
              onClick={() => window.location.href = '/'}
              className="px-6 py-3 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors"
            >
              Create Your First Build
            </button>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {builds.map((build) => (
              <div
                key={build.sessionId}
                className="bg-white border border-gray-200 rounded-xl p-6 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-black truncate">
                      {build.projectName}
                    </h3>
                    {build.appDescription && (
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                        {build.appDescription}
                      </p>
                    )}
                  </div>
                  {build.isShared && (
                    <div className="ml-2 px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                      Shared
                    </div>
                  )}
                </div>

                <div className="space-y-2 text-sm text-gray-600 mb-4">
                  <div className="flex justify-between">
                    <span>Size:</span>
                    <span>{build.displaySize}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Files:</span>
                    <span>{build.fileCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Last accessed:</span>
                    <span>{formatDistanceToNow(new Date(build.lastAccessed), { addSuffix: true })}</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleRestore(build.sessionId)}
                    className="flex-1 px-3 py-2 bg-black text-white text-sm rounded-lg hover:bg-gray-800 transition-colors"
                  >
                    Restore
                  </button>
                  
                  <button
                    onClick={() => handleShare(build.sessionId)}
                    disabled={shareBuild.isPending}
                    className="px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
                    title="Share build"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                    </svg>
                  </button>

                  <button
                    onClick={() => handleDelete(build.sessionId)}
                    disabled={deleteBuild.isPending}
                    className="px-3 py-2 bg-red-100 text-red-700 text-sm rounded-lg hover:bg-red-200 transition-colors disabled:opacity-50"
                    title="Delete build"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Storage Usage Footer */}
        {storageConfig && builds.length > 0 && (
          <div className="mt-12 pt-8 border-t border-gray-200">
            <div className="text-center text-sm text-gray-600">
              <div className="flex items-center justify-center gap-6">
                <span>
                  <strong>{builds.length}</strong> of {storageConfig.maxBuildsPerUser} builds
                </span>
                <span>
                  Retention: <strong>{storageConfig.retentionDays} days</strong>
                </span>
                <span>
                  Max size: <strong>{storageConfig.maxSizeMB} MB</strong>
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}