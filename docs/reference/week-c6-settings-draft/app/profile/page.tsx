'use client';

import { trpc } from '@/lib/trpc';

const MOCK_USER_ID = 'user-1';

export default function ProfilePage() {
  const { data: profile, isLoading } = trpc.profile.getProfile.useQuery(
    { userId: MOCK_USER_ID },
    { retry: false }
  );

  const { data: sessions } = trpc.profile.getSessions.useQuery(
    { userId: MOCK_USER_ID },
    { enabled: !!profile }
  );

  const revokeMutation = trpc.profile.revokeSession.useMutation();

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center text-gray-500 dark:text-gray-400">
          Profile not found. This is a mock implementation.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Profile</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Manage your profile information and active sessions
        </p>
      </div>

      <div className="space-y-8">
        {/* Profile Info */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
            Profile Information
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Email
              </label>
              <p className="mt-1 text-gray-900 dark:text-white">{profile.email}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Name
              </label>
              <p className="mt-1 text-gray-900 dark:text-white">
                {profile.name || 'Not set'}
              </p>
            </div>
          </div>
        </div>

        {/* Active Sessions */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
            Active Sessions
          </h2>
          {sessions && sessions.length > 0 ? (
            <div className="space-y-3">
              {sessions.map((session: any) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between p-3 border border-gray-200 dark:border-gray-700 rounded-lg"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {session.device || 'Unknown Device'}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      Last active: {new Date(session.lastActive).toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      revokeMutation.mutate({
                        userId: MOCK_USER_ID,
                        sessionId: session.id,
                        currentSessionId: 'current-session',
                      })
                    }
                    className="px-3 py-1 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-400">No active sessions</p>
          )}
        </div>

        {/* Danger Zone */}
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800 p-6">
          <h2 className="text-xl font-bold text-red-900 dark:text-red-200 mb-2">
            Danger Zone
          </h2>
          <p className="text-sm text-red-800 dark:text-red-300 mb-4">
            Once you delete your account, there is no going back. Please be certain.
          </p>
          <button
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            onClick={() => alert('Account deletion flow not implemented')}
          >
            Delete Account
          </button>
        </div>
      </div>
    </div>
  );
}
