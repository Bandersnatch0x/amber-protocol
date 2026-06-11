import Link from 'next/link';

export default function RoutesPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Routes</h1>
        <p className="mt-2 text-sm text-gray-600">
          Route browsing coming in Week C2
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
        <svg
          className="mx-auto h-12 w-12 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-gray-900">Coming Soon</h3>
        <p className="mt-1 text-sm text-gray-500">
          Route visualization and browsing will be available in the next release
        </p>
        <div className="mt-6">
          <Link
            href="/sessions"
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
          >
            View Sessions Instead
          </Link>
        </div>
      </div>
    </div>
  );
}
