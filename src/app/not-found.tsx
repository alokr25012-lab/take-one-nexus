import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] px-4 text-center">
      {/* Cinematic Gradient 404 Header */}
      <h1 className="text-8xl md:text-9xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-purple-600 mb-6 drop-shadow-lg">
        404
      </h1>
      
      {/* Subheading with Dark Mode Support */}
      <h2 className="text-3xl md:text-4xl font-semibold text-gray-800 dark:text-gray-200 mb-4 tracking-tight">
        Lost in the Nexus.
      </h2>
      
      {/* Thematic Description */}
      <p className="text-lg md:text-xl text-gray-600 dark:text-gray-400 max-w-lg mb-10 leading-relaxed">
        The page you are looking for has vanished into the void, or it never existed in the first place. Let's get you back on track.
      </p>
      
      {/* Call to Action Button */}
      <Link 
        href="/" 
        className="px-8 py-3 text-white font-medium bg-blue-600 rounded-full hover:bg-blue-700 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 ease-in-out"
      >
        Return to Dashboard
      </Link>
    </div>
  );
}