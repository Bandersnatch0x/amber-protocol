import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Amber Protocol Web Viewer
        </h1>
        <p className="text-xl text-gray-600 mb-8">
          Monitor and visualize your autonomous coding sessions
        </p>
        <div className="flex justify-center space-x-4">
          <Link
            href="/sessions"
            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
          >
            View Sessions
          </Link>
          <Link
            href="/routes"
            className="inline-flex items-center px-6 py-3 border border-gray-300 text-base font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            Browse Routes
          </Link>
        </div>
      </div>

      <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-3">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Real-time Monitoring
          </h3>
          <p className="text-gray-600">
            Watch your sessions execute in real-time with live timeline updates
          </p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Session Control
          </h3>
          <p className="text-gray-600">
            Start, pause, and abort sessions directly from the web interface
          </p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Timeline Visualization
          </h3>
          <p className="text-gray-600">
            Inspect every event in your session execution timeline
          </p>
        </div>
      </div>
    </div>
  );
}
